/**
 * @fileoverview `validate-dependencies` and `fix-dependencies`: find the
 * dependencies that name a missing task, the task itself, or a loop, and
 * remove the ones that can be removed without a decision (missing, self,
 * duplicate, loops made only of subtasks). Loops through a task are left for
 * the user to break.
 *
 * The functions work on a tag's tasks as stored, so a task ID may be a number
 * (older files) or a string (what tm-core saves): IDs are compared as
 * strings, and reported as they are stored. A bare number up to 99 in a
 * subtask's dependencies is a sibling subtask (see subtask-dependency.ts).
 */

import { isTaskComplete } from '../../common/constants/index.js';
import type { Subtask, Task } from '../../common/types/index.js';
import type { PrdCoverage } from '../prd/prd-coverage.js';
import { isArchivedReference, liveOrArchived } from '../tasks/utils/archive.js';
import { stronglyConnectedComponents } from './dependency-graph.js';
import {
	assignMetadata,
	pruneDependencySources
} from './dependency-provenance.js';
import {
	isSiblingReference,
	resolveSubtaskDependency
} from './subtask-dependency.js';
import { findDanglingLinks, pruneTaskLinks } from './task-links.js';

type Id = string | number;

/** One problem validation found */
export interface DependencyIssue {
	/** `missing-link`: a related or discovered-from link to a missing task */
	type: 'missing' | 'self' | 'circular' | 'missing-link';
	taskId: Id;
	dependencyId?: Id;
	/** For a loop: whether fixDependencies can break it (subtasks only) */
	fixable?: boolean;
	message: string;
}

/** One dependency or link fixDependencies removed */
export interface DependencyFix {
	type: 'missing' | 'self' | 'duplicate' | 'circular' | 'missing-link';
	taskId: Id;
	dependencyId?: Id;
}

export interface DependencyCounts {
	taskCount: number;
	subtaskCount: number;
	dependencyCount: number;
}

/** What `validate-dependencies` reports */
export interface DependencyCheckResult extends DependencyCounts {
	valid: boolean;
	issues: DependencyIssue[];
	/** Null unless parse-prd recorded PRD sources; gaps don't fail the check */
	prdCoverage: PrdCoverage | null;
	tasksPath: string;
}

/** What `fix-dependencies` did */
export interface DependencyFixResult extends DependencyCounts {
	fixes: DependencyFix[];
	/** Problems that need a decision, such as a loop between tasks */
	remaining: DependencyIssue[];
	/** Whether tasks.json changed */
	changed: boolean;
	tag: string;
	tasksPath: string;
}

/**
 * Every task and subtask's dependencies as full IDs ("3", "3.2"), without
 * self-dependencies, which are reported on their own
 * @param subtasksOnly - Keep only edges between subtasks, the ones
 *   fixDependencies can break
 */
function dependencyEdges(
	tasks: Task[],
	{ subtasksOnly = false } = {}
): Map<string, string[]> {
	const graph = new Map<string, string[]>();
	const add = (id: string, deps: string[]) => {
		graph.set(
			id,
			deps.filter((dep) => dep !== id && (!subtasksOnly || dep.includes('.')))
		);
	};
	for (const task of tasks) {
		const taskId = String(task.id);
		if (!subtasksOnly) add(taskId, (task.dependencies || []).map(String));
		for (const subtask of task.subtasks || []) {
			add(
				`${taskId}.${subtask.id}`,
				(subtask.dependencies || []).map((dep) =>
					resolveSubtaskDependency(taskId, dep)
				)
			);
		}
	}
	return graph;
}

/** Strongly connected components of an edge map (see dependency-graph.ts) */
function components(
	graph: Map<string, string[]>,
	ids: Iterable<string> = graph.keys(),
	inScope: (id: string) => boolean = (id) => graph.has(id)
): string[][] {
	return stronglyConnectedComponents(
		[...ids],
		(id) => graph.get(id) ?? [],
		inScope
	);
}

/**
 * The IDs in a loop: one of their dependencies leads back to them. A task
 * that only depends on a loop is not in it. Self-dependencies aren't edges,
 * so they never count as a loop.
 */
function findLoopMembers(graph: Map<string, string[]>): Set<string> {
	const members = new Set<string>();
	for (const component of components(graph)) {
		if (component.length > 1) {
			for (const member of component) members.add(member);
		}
	}
	return members;
}

/**
 * Whether `to` can be reached from `from` along dependencies. Iterative, so a
 * long chain can't overflow the stack.
 */
export function dependsOnTransitively(
	tasks: Task[],
	from: string,
	to: string
): boolean {
	const graph = dependencyEdges(tasks);
	const seen = new Set<string>([from]);
	const queue = [from];
	while (queue.length > 0) {
		const id = queue.pop() as string;
		if (id === to) return true;
		for (const next of graph.get(id) ?? []) {
			if (!seen.has(next)) {
				seen.add(next);
				queue.push(next);
			}
		}
	}
	return false;
}

/**
 * Whether an ID names a task (by its number) or a subtask ("parent.sub";
 * anything after a second dot is ignored), answered from an index
 */
export function createTaskLookup(tasks: Task[]): (id: Id) => boolean {
	// Task ID -> its subtask IDs (null when it has none); the first task wins
	const subtaskIds = new Map<string, Set<string> | null>();
	for (const task of tasks) {
		const key = String(task.id);
		if (subtaskIds.has(key)) continue;
		subtaskIds.set(
			key,
			task.subtasks ? new Set(task.subtasks.map((st) => String(st.id))) : null
		);
	}

	return (id) => {
		if (!id) return false;
		if (typeof id === 'string' && id.includes('.')) {
			const [parentId, subtaskId] = id.split('.').map((n) => parseInt(n, 10));
			if (Number.isNaN(parentId) || Number.isNaN(subtaskId)) return false;
			return subtaskIds.get(String(parentId))?.has(String(subtaskId)) ?? false;
		}
		const taskId = parseInt(String(id), 10);
		return !Number.isNaN(taskId) && subtaskIds.has(String(taskId));
	};
}

/**
 * Where a dependency stands: `open` holds its task up, `satisfied` doesn't,
 * `missing` matches no task or subtask
 */
export type DependencyState = 'open' | 'satisfied' | 'missing';

/**
 * The one rule `next`, `why`, `graph` and `list --ready` share for whether a
 * dependency still holds up the task (`"3"`) or subtask (`"3.2"`) that lists
 * it. A finished task or subtask is satisfied, and so is a subtask of a
 * finished task (setting a parent done leaves its subtasks as they were). A
 * task's dependency on one of its own subtasks is satisfied: the subtask
 * runs inside the task, so it can't come first. IDs match exactly, as
 * stored; pass a subtask's dependencies through `resolveSubtaskDependency`.
 */
export function createDependencyState(
	tasks: Task[]
): (taskId: string, depId: string) => DependencyState {
	const byId = new Map(tasks.map((t) => [String(t.id), t]));
	return (taskId, depId) => {
		const task = byId.get(depId);
		if (task) return isTaskComplete(task.status) ? 'satisfied' : 'open';
		const dot = depId.indexOf('.');
		const parent = dot > 0 ? byId.get(depId.slice(0, dot)) : undefined;
		const subtask = parent?.subtasks?.find(
			(s) => String(s.id) === depId.slice(dot + 1)
		);
		if (!parent || !subtask) return 'missing';
		return String(parent.id) === taskId ||
			isTaskComplete(parent.status) ||
			isTaskComplete(subtask.status ?? 'pending')
			? 'satisfied'
			: 'open';
	};
}

/**
 * Every dependency problem in a tag's tasks, without changing anything
 * @param archivedIds - Archived task IDs; dependencies on them count as done
 */
export function validateTaskDependencies(
	tasks: Task[],
	archivedIds: ReadonlySet<string> = new Set()
): { valid: boolean; issues: DependencyIssue[] } {
	const issues: DependencyIssue[] = [];
	const loopMembers = findLoopMembers(dependencyEdges(tasks));
	const subtaskLoopMembers = findLoopMembers(
		dependencyEdges(tasks, { subtasksOnly: true })
	);
	const lookup = createTaskLookup(tasks);
	const exists = (id: Id) => lookup(id) || isArchivedReference(id, archivedIds);

	for (const task of tasks) {
		if (!task.dependencies) continue;

		for (const depId of task.dependencies as Id[]) {
			if (String(depId) === String(task.id)) {
				issues.push({
					type: 'self',
					taskId: task.id,
					message: `Task ${task.id} depends on itself`
				});
				continue;
			}
			if (!exists(depId)) {
				issues.push({
					type: 'missing',
					taskId: task.id,
					dependencyId: depId,
					message: `Task ${task.id} depends on non-existent task ${depId}`
				});
			}
		}

		// Self-dependencies were reported above and aren't in the graph
		if (loopMembers.has(String(task.id))) {
			issues.push({
				type: 'circular',
				taskId: task.id,
				// A loop through a task needs the user to choose which edge goes
				fixable: false,
				message: `Task ${task.id} is part of a circular dependency chain`
			});
		}

		for (const subtask of task.subtasks || []) {
			if (!subtask.dependencies) continue;
			const fullSubtaskId = `${task.id}.${subtask.id}`;

			for (const depId of subtask.dependencies) {
				if (
					String(depId) === fullSubtaskId ||
					(isSiblingReference(depId) && depId === subtask.id)
				) {
					issues.push({
						type: 'self',
						taskId: fullSubtaskId,
						message: `Subtask ${fullSubtaskId} depends on itself`
					});
					continue;
				}
				const ref = isSiblingReference(depId)
					? resolveSubtaskDependency(task.id, depId)
					: depId;
				if (!exists(ref)) {
					issues.push({
						type: 'missing',
						taskId: fullSubtaskId,
						dependencyId: ref,
						message: `Subtask ${fullSubtaskId} depends on non-existent task/subtask ${depId}`
					});
				}
			}

			if (loopMembers.has(fullSubtaskId)) {
				issues.push({
					type: 'circular',
					taskId: fullSubtaskId,
					// fixDependencies breaks loops made only of subtasks
					fixable: subtaskLoopMembers.has(fullSubtaskId),
					message: `Subtask ${fullSubtaskId} is part of a circular dependency chain`
				});
			}
		}
	}

	// Related and discovered-from links never block, but one to a task that
	// is gone is still stale
	for (const link of findDanglingLinks(tasks, (id) => exists(id))) {
		issues.push({
			type: 'missing-link',
			taskId: link.taskId,
			dependencyId: link.linkedId,
			message: `Task ${link.taskId} links to non-existent task ${link.linkedId}`
		});
	}

	return { valid: issues.length === 0, issues };
}

/** How many tasks, subtasks and dependencies there are, for summaries */
export function countTasksAndDependencies(tasks: Task[]): DependencyCounts {
	let subtaskCount = 0;
	let dependencyCount = 0;
	for (const task of tasks) {
		if (Array.isArray(task.dependencies)) {
			dependencyCount += task.dependencies.length;
		}
		if (!Array.isArray(task.subtasks)) continue;
		subtaskCount += task.subtasks.length;
		for (const subtask of task.subtasks) {
			if (Array.isArray(subtask.dependencies)) {
				dependencyCount += subtask.dependencies.length;
			}
		}
	}
	return { taskCount: tasks.length, subtaskCount, dependencyCount };
}

/**
 * Break loops between subtasks: in order, drop each dependency that leads
 * back to the subtask it starts from. Removing edges as it goes means each
 * loop loses exactly one edge. A dependency leads back exactly when both ends
 * are in the same strongly connected component, so the components answer
 * each check, and only the component that lost an edge is worked out again.
 * Dependencies on tasks are not followed. Changes `tasks` in place.
 * @returns The dropped dependencies, in order, as full IDs
 */
export function breakSubtaskLoops(
	tasks: Task[]
): Array<{ taskId: string; dependencyId: string }> {
	// Subtask ID -> its dependencies as full IDs
	const graph = new Map<string, string[]>();
	for (const task of tasks) {
		for (const subtask of task.subtasks || []) {
			graph.set(
				`${task.id}.${subtask.id}`,
				Array.isArray(subtask.dependencies)
					? subtask.dependencies.map((depId) =>
							resolveSubtaskDependency(task.id, depId)
						)
					: []
			);
		}
	}

	// The subtask a full ID names; the first match wins, as a find would
	const subtasks = new Map<string, Subtask>();
	for (const task of tasks) {
		for (const st of task.subtasks || []) {
			const id = `${task.id}.${st.id}`;
			if (!subtasks.has(id)) subtasks.set(id, st);
		}
	}

	const componentOf = new Map<string, string[]>();
	const assign = (found: string[][]) => {
		for (const component of found) {
			for (const id of component) componentOf.set(id, component);
		}
	};
	assign(components(graph));

	const removed: Array<{ taskId: string; dependencyId: string }> = [];
	for (const [subtaskId, dependencies] of graph) {
		const subtask = subtasks.get(subtaskId);
		if (!subtask?.dependencies) continue;
		const parentId = subtaskId.split('.')[0];

		for (const depId of [...dependencies]) {
			const component = componentOf.get(subtaskId) as string[];
			const leadsBack =
				depId === subtaskId || componentOf.get(depId) === component;
			if (!leadsBack) continue;

			const originalLength = subtask.dependencies.length;
			subtask.dependencies = subtask.dependencies.filter(
				(dep) => resolveSubtaskDependency(parentId, dep) !== depId
			);
			dependencies.splice(dependencies.indexOf(depId), 1);

			// Without that edge the component may have split
			if (depId !== subtaskId) {
				assign(
					components(
						graph,
						component,
						(id) => componentOf.get(id) === component
					)
				);
			}

			if (subtask.dependencies.length < originalLength) {
				removed.push({ taskId: subtaskId, dependencyId: depId });
			}
		}
	}
	return removed;
}

/**
 * Drop provenance marks for dependencies that no longer exist, on every task
 * and subtask
 */
function pruneProvenance(tasks: Task[]): void {
	for (const task of tasks) {
		if (task.metadata) assignMetadata(task, pruneDependencySources(task));
		for (const subtask of task.subtasks || []) {
			if (subtask.metadata) {
				assignMetadata(subtask, pruneDependencySources(subtask, task.id));
			}
		}
	}
}

/** `dependencies` without repeats, keeping the first; each removal is a fix */
function dropDuplicates<T extends Id>(
	dependencies: T[],
	key: (dep: T) => string,
	onDuplicate: (dep: T, id: string) => void
): T[] {
	const seen = new Set<string>();
	return dependencies.filter((dep) => {
		const id = key(dep);
		if (seen.has(id)) {
			onDuplicate(dep, id);
			return false;
		}
		seen.add(id);
		return true;
	});
}

/**
 * Remove references to tasks that don't exist, self-dependencies and
 * duplicates, break loops between subtasks, and drop links to missing tasks.
 * Changes `tasks` in place.
 * @param archivedIds - Archived task IDs; dependencies on them are kept
 * @returns What was removed, in order, and the problems left (loops through
 *   a task), as validateTaskDependencies reports them
 */
export function fixTaskDependencies(
	tasks: Task[],
	archivedIds: ReadonlySet<string> = new Set()
): { fixes: DependencyFix[]; remaining: DependencyIssue[] } {
	const fixes: DependencyFix[] = [];

	// Duplicates first: on a task `1` and `"1"` are the same, on a subtask a
	// bare number is a sibling
	for (const task of tasks) {
		if (Array.isArray(task.dependencies)) {
			task.dependencies = dropDuplicates(
				task.dependencies as Id[],
				String,
				(dep) =>
					fixes.push({ type: 'duplicate', taskId: task.id, dependencyId: dep })
			) as string[];
		}
		for (const subtask of task.subtasks || []) {
			if (!Array.isArray(subtask.dependencies)) continue;
			subtask.dependencies = dropDuplicates(
				subtask.dependencies,
				(dep) => resolveSubtaskDependency(task.id, dep),
				(_dep, id) =>
					fixes.push({
						type: 'duplicate',
						taskId: `${task.id}.${subtask.id}`,
						dependencyId: id
					})
			);
		}
	}

	const archived = (depId: Id) => isArchivedReference(depId, archivedIds);
	const validTaskIds = new Set(tasks.map((t) => String(t.id)));
	const isTask = (depId: Id) =>
		validTaskIds.has(String(parseInt(String(depId), 10)));
	const validSubtaskIds = new Set<string>();
	for (const task of tasks) {
		for (const subtask of task.subtasks || []) {
			validSubtaskIds.add(`${task.id}.${subtask.id}`);
		}
	}

	for (const task of tasks) {
		if (Array.isArray(task.dependencies)) {
			task.dependencies = (task.dependencies as Id[]).filter((depId) => {
				if (String(depId) === String(task.id)) {
					fixes.push({ type: 'self', taskId: task.id });
					return false;
				}
				if (archived(depId) && !isTask(depId)) return true;
				const known =
					typeof depId === 'string' && depId.includes('.')
						? validSubtaskIds.has(depId)
						: isTask(depId);
				if (!known) {
					fixes.push({ type: 'missing', taskId: task.id, dependencyId: depId });
				}
				return known;
			}) as string[];
		}

		for (const subtask of task.subtasks || []) {
			if (!Array.isArray(subtask.dependencies)) continue;
			const subtaskId = `${task.id}.${subtask.id}`;

			subtask.dependencies = subtask.dependencies.filter((depId) => {
				if (resolveSubtaskDependency(task.id, depId) === subtaskId) {
					fixes.push({ type: 'self', taskId: subtaskId });
					return false;
				}
				return true;
			});

			subtask.dependencies = subtask.dependencies.filter((depId) => {
				if (!isSiblingReference(depId) && archived(depId) && !isTask(depId)) {
					return true;
				}
				if (typeof depId === 'string' && depId.includes('.')) {
					if (validSubtaskIds.has(depId)) return true;
					fixes.push({
						type: 'missing',
						taskId: subtaskId,
						dependencyId: depId
					});
					return false;
				}
				// A bare number names a sibling subtask; a string like "3" is
				// task 3, the form add-dependency stores
				if (isSiblingReference(depId)) {
					const fullSubtaskId = `${task.id}.${depId}`;
					if (validSubtaskIds.has(fullSubtaskId)) return true;
					fixes.push({
						type: 'missing',
						taskId: subtaskId,
						dependencyId: fullSubtaskId
					});
					return false;
				}
				if (isTask(depId)) return true;
				fixes.push({ type: 'missing', taskId: subtaskId, dependencyId: depId });
				return false;
			});
		}
	}

	for (const { taskId, dependencyId } of breakSubtaskLoops(tasks)) {
		fixes.push({ type: 'circular', taskId, dependencyId });
	}

	pruneProvenance(tasks);

	// A link to an archived task isn't dangling
	for (const link of pruneTaskLinks(
		tasks,
		liveOrArchived(tasks, archivedIds)
	)) {
		fixes.push({
			type: 'missing-link',
			taskId: link.taskId,
			dependencyId: link.linkedId
		});
	}

	return {
		fixes,
		// Loops between tasks are left for the user to break
		remaining: validateTaskDependencies(tasks, archivedIds).issues
	};
}
