/**
 * @fileoverview Deterministic checks on a generated plan: the tasks
 * parse-prd, analyze-complexity and expand produced from one PRD.
 *
 * Each check returns a score from 0 to 1 and the items behind it, so a drop
 * in the score can be traced to the tasks that caused it. `npm run evals`
 * runs these on real model output; the LLM judge is scored apart from them.
 */

import type { Task } from '../../common/types/index.js';
import { findCycles } from '../dependencies/dependency-graph.js';
import { resolveSubtaskDependency } from '../dependencies/subtask-dependency.js';
import { isClarificationsHeading } from '../prd/clarifications.js';
import { computePrdCoverage } from '../prd/prd-coverage.js';
import { type PrdSection, parsePrdSections } from '../prd/prd-sections.js';
import { normalizeAcceptanceCriteria } from '../tasks/utils/acceptance-criteria.js';

/** A subtask as tasks.json stores it */
export interface PlanSubtask {
	id: number | string;
	title?: string;
	dependencies?: Array<number | string>;
	acceptanceCriteria?: unknown;
}

/** A top-level task as tasks.json stores it */
export interface PlanTask {
	id: number | string;
	title?: string;
	status?: string;
	dependencies?: Array<number | string>;
	subtasks?: PlanSubtask[];
	acceptanceCriteria?: unknown;
	metadata?: Record<string, unknown>;
}

/** One entry of a complexity report */
export interface PlanComplexity {
	taskId: number | string;
	complexityScore: number;
}

/** How big a PRD is */
export interface PrdSize {
	words: number;
	sections: number;
}

export function measurePrd(markdown: string): PrdSize {
	const words = markdown.match(/\S*[\p{L}\p{N}]\S*/gu)?.length ?? 0;
	return { words, sections: parsePrdSections(markdown).length };
}

export interface HeadingCoverageCheck {
	score: number;
	sections: number;
	/** Headings no task covers, in document order */
	uncovered: string[];
	/** Tasks that name no PRD section */
	unsourced: string[];
}

/**
 * Headings that say what not to build, which no task should implement.
 * Matched on the whole heading, ignoring case.
 */
const NO_TASK_HEADING = /^(out[- ]of[- ]scope|non[- ]?goals?|open questions)$/i;

/**
 * Top-level headings that introduce the product rather than ask for work.
 * Users, Sources or Performance can carry requirements, so they stay counted.
 */
const INTRO_HEADING =
	/^(overview|summary|background|context|introduction|goals|motivation|problem)$/i;

/**
 * Slugs of the headings that need no task: what not to build and the
 * Clarifications section, with every heading inside them, and top-level
 * intro headings alone (a subsection under Goals can still ask for work).
 */
function noTaskSlugs(sections: PrdSection[]): Set<string> {
	const skip = new Set<string>();
	const intro: string[] = [];
	// Sections come in document order, so a parent is decided before its children
	for (const section of sections) {
		if (
			NO_TASK_HEADING.test(section.title.trim()) ||
			isClarificationsHeading(section.title, section.level) ||
			(section.parentSlug && skip.has(section.parentSlug))
		) {
			skip.add(section.slug);
		} else if (section.level <= 2 && INTRO_HEADING.test(section.title.trim())) {
			intro.push(section.slug);
		}
	}
	return new Set([...skip, ...intro]);
}

/**
 * Share of PRD headings covered by a task, using the sections parse-prd
 * records in `metadata.source` (see `computePrdCoverage`). With no task
 * citing the PRD at all, nothing is covered. Out of scope, non-goals, open
 * questions and the Clarifications section (and headings inside them), and
 * top-level intro headings (Overview, Goals...) themselves, need no task,
 * so they aren't counted.
 *
 * @param prdPath - The path tasks cite the PRD by
 */
export function checkHeadingCoverage(
	tasks: PlanTask[],
	prdPath: string,
	prdContent: string
): HeadingCoverageCheck {
	const all = parsePrdSections(prdContent);
	const skip = noTaskSlugs(all);
	const sections = all.filter((s) => !skip.has(s.slug));
	const coverage = computePrdCoverage(tasks, (cited) =>
		cited === prdPath ? prdContent : null
	);
	const file = coverage?.files.find((f) => f.path === prdPath);
	const uncovered = (file ? file.uncovered : sections)
		.filter((s) => !skip.has(s.slug))
		.map((s) => s.title);
	const unsourced = coverage
		? coverage.unsourced
		: tasks.filter((t) => t.status !== 'cancelled');
	return {
		score:
			sections.length === 0
				? 1
				: (sections.length - uncovered.length) / sections.length,
		sections: sections.length,
		uncovered,
		unsourced: unsourced.map((t) => String(t.id))
	};
}

export type InvalidDependencyReason = 'missing' | 'not-lower' | 'self';

export interface InvalidDependency {
	/** The task or subtask (`3.2`) that lists the dependency */
	id: string;
	dependency: string;
	reason: InvalidDependencyReason;
}

export interface DependencyCheck {
	/** Valid edges over all edges; 0 when there is a cycle */
	score: number;
	edges: number;
	cycles: string[][];
	invalid: InvalidDependency[];
}

const compareNumbers = (a: string, b: string): number => Number(a) - Number(b);

/**
 * No cycles, and every dependency names an existing, earlier item: a task
 * a lower task (or one of its subtasks), a subtask a lower sibling or an
 * item of a task below its parent. A
 * subtask depending on a task at or above its parent would make the parent
 * wait on that task too.
 */
export function checkDependencies(tasks: PlanTask[]): DependencyCheck {
	const ids = new Set<string>();
	for (const task of tasks) {
		ids.add(String(task.id));
		for (const sub of task.subtasks ?? []) ids.add(`${task.id}.${sub.id}`);
	}

	const invalid: InvalidDependency[] = [];
	let edges = 0;
	const record = (
		id: string,
		dependency: string,
		reason: InvalidDependencyReason | null
	) => {
		edges++;
		if (reason) invalid.push({ id, dependency, reason });
	};

	for (const task of tasks) {
		const id = String(task.id);
		for (const raw of task.dependencies ?? []) {
			const dep = String(raw);
			record(
				id,
				dep,
				dep === id
					? 'self'
					: !ids.has(dep)
						? 'missing'
						: compareNumbers(dep.split('.')[0], id) >= 0
							? 'not-lower'
							: null
			);
		}
		for (const sub of task.subtasks ?? []) {
			const subId = `${id}.${sub.id}`;
			for (const raw of sub.dependencies ?? []) {
				const dep = resolveSubtaskDependency(id, raw);
				let reason: InvalidDependencyReason | null = null;
				if (dep === subId) reason = 'self';
				else if (!ids.has(dep)) reason = 'missing';
				else if (dep.startsWith(`${id}.`)) {
					if (compareNumbers(dep.slice(id.length + 1), String(sub.id)) >= 0)
						reason = 'not-lower';
				} else {
					const [taskPart] = dep.split('.');
					if (compareNumbers(taskPart, id) >= 0) reason = 'not-lower';
				}
				record(subId, dep, reason);
			}
		}
	}

	const cycles = findCycles(tasks as unknown as Task[]);
	return {
		score: cycles.length > 0 ? 0 : edges === 0 ? 1 : 1 - invalid.length / edges,
		edges,
		cycles,
		invalid
	};
}

export interface AcceptanceCriteriaCheck {
	/** Share of tasks and subtasks with at least one criterion */
	score: number;
	items: number;
	/** Tasks and subtasks (`3.2`) without criteria */
	missing: string[];
}

export function checkAcceptanceCriteria(
	tasks: PlanTask[]
): AcceptanceCriteriaCheck {
	const missing: string[] = [];
	let items = 0;
	const visit = (id: string, criteria: unknown) => {
		items++;
		if (normalizeAcceptanceCriteria(criteria).length === 0) missing.push(id);
	};
	for (const task of tasks) {
		visit(String(task.id), task.acceptanceCriteria);
		for (const sub of task.subtasks ?? []) {
			visit(`${task.id}.${sub.id}`, sub.acceptanceCriteria);
		}
	}
	return {
		score: items === 0 ? 0 : (items - missing.length) / items,
		items,
		missing
	};
}

/** Ranks from 1, ties sharing their average rank */
function ranks(values: number[]): number[] {
	const order = values
		.map((value, index) => ({ value, index }))
		.sort((a, b) => a.value - b.value);
	const result = new Array<number>(values.length);
	for (let i = 0; i < order.length; ) {
		let j = i;
		while (j + 1 < order.length && order[j + 1].value === order[i].value) j++;
		const rank = (i + j) / 2 + 1;
		for (let k = i; k <= j; k++) result[order[k].index] = rank;
		i = j + 1;
	}
	return result;
}

/**
 * Spearman rank correlation, from -1 to 1. Null with fewer than 3 pairs, or
 * when either side has no spread (every value the same), since an order
 * can't be compared then.
 */
export function rankCorrelation(xs: number[], ys: number[]): number | null {
	if (xs.length !== ys.length || xs.length < 3) return null;
	const rx = ranks(xs);
	const ry = ranks(ys);
	const mean = (rx.length + 1) / 2;
	let cov = 0;
	let vx = 0;
	let vy = 0;
	for (let i = 0; i < rx.length; i++) {
		const dx = rx[i] - mean;
		const dy = ry[i] - mean;
		cov += dx * dy;
		vx += dx * dx;
		vy += dy * dy;
	}
	if (vx === 0 || vy === 0) return null;
	return cov / Math.sqrt(vx * vy);
}

export interface SubtaskComplexityCheck {
	/** The correlation clamped to 0..1; null when it can't be computed */
	score: number | null;
	correlation: number | null;
	pairs: Array<{ taskId: string; complexity: number; subtasks: number }>;
}

/**
 * Whether more complex tasks got more subtasks: the rank correlation of
 * each task's complexity score with its subtask count.
 */
export function checkSubtaskComplexity(
	tasks: PlanTask[],
	complexity: PlanComplexity[]
): SubtaskComplexityCheck {
	const scores = new Map(
		complexity.map((entry) => [String(entry.taskId), entry.complexityScore])
	);
	const pairs = tasks.flatMap((task) => {
		const score = scores.get(String(task.id));
		return typeof score === 'number'
			? [
					{
						taskId: String(task.id),
						complexity: score,
						subtasks: task.subtasks?.length ?? 0
					}
				]
			: [];
	});
	const correlation = rankCorrelation(
		pairs.map((p) => p.complexity),
		pairs.map((p) => p.subtasks)
	);
	return {
		score: correlation === null ? null : Math.max(0, correlation),
		correlation,
		pairs
	};
}

export interface TaskScalingSample {
	id: string;
	words: number;
	taskCount: number;
}

export interface TaskScalingCheck {
	score: number | null;
	correlation: number | null;
	samples: TaskScalingSample[];
}

/**
 * Whether bigger PRDs got more tasks, across every PRD in a run: the rank
 * correlation of PRD word count with task count.
 */
export function checkTaskScaling(
	samples: TaskScalingSample[]
): TaskScalingCheck {
	const correlation = rankCorrelation(
		samples.map((s) => s.words),
		samples.map((s) => s.taskCount)
	);
	return {
		score: correlation === null ? null : Math.max(0, correlation),
		correlation,
		samples
	};
}

export interface PlanChecks {
	headingCoverage: HeadingCoverageCheck;
	dependencies: DependencyCheck;
	acceptanceCriteria: AcceptanceCriteriaCheck;
	subtaskComplexity: SubtaskComplexityCheck;
}

export interface PlanCheckInput {
	tasks: PlanTask[];
	/** The path tasks cite the PRD by in `metadata.source` */
	prdPath: string;
	prdContent: string;
	complexity: PlanComplexity[];
}

/** Every per-PRD check, and their mean (checks that can't score are left out) */
export function checkPlan(input: PlanCheckInput): {
	checks: PlanChecks;
	score: number;
} {
	const checks: PlanChecks = {
		headingCoverage: checkHeadingCoverage(
			input.tasks,
			input.prdPath,
			input.prdContent
		),
		dependencies: checkDependencies(input.tasks),
		acceptanceCriteria: checkAcceptanceCriteria(input.tasks),
		subtaskComplexity: checkSubtaskComplexity(input.tasks, input.complexity)
	};
	const scores = Object.values(checks)
		.map((check) => check.score)
		.filter((score): score is number => score !== null);
	return {
		checks,
		score: scores.reduce((sum, s) => sum + s, 0) / scores.length
	};
}
