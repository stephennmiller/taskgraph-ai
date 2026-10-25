/**
 * @fileoverview scope-up / scope-down: the AI rewrites tasks to be more or
 * less complex, then rewrites their pending subtasks to match. Subtasks with
 * work on them (any status but pending) stay. The AI calls run without the
 * tasks.json lock; each task's save re-reads the file under it and changes
 * only that task, so edits made during the calls stay.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Subtask, Task } from '../../../common/types/index.js';
import {
	type AggregatedTelemetry,
	aggregateTelemetry
} from '../../ai/aggregate-telemetry.js';
import {
	AiService,
	type AiServiceResult,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import {
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import { dropReferences } from '../../dependencies/removed-references.js';
import { fullSubtaskId } from '../validation/task-id.js';
import {
	AnalyzeComplexityService,
	readComplexityReport
} from './analyze-complexity.service.js';
import {
	RegeneratedSubtasksSchema,
	SCOPE_STRENGTHS,
	type ScopeDirection,
	type ScopeStrength,
	ScopedTaskSchema,
	regenerateSubtasksPrompt,
	scopeTaskPrompt,
	targetSubtaskCount
} from './scope-adjustment-prompts.js';
import type { TaskService } from './task-service.js';
import { mergeRewrite } from './update-task-helpers.js';

export interface ScopeTaskInput {
	/** Comma-separated top-level task IDs ("1,3,5") */
	ids: string;
	direction: ScopeDirection;
	/** light, regular (the default) or heavy */
	strength?: string;
	/** Extra instructions for the AI */
	prompt?: string;
	/** Use the research role */
	research?: boolean;
	/** The active tag when left out */
	tag?: string;
	/**
	 * The MCP session, for its env. Only a call with one re-scores the task
	 * in the complexity report afterwards, as the legacy MCP tools did.
	 */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

export interface ScopeTaskHooks {
	/** Something the user should know, such as subtasks that weren't rewritten */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** An AI call is about to start for this task */
	onAiCall?: (context: { taskId: string; step: 'task' | 'subtasks' }) => void;
}

export interface ScopedTask {
	/** The task as saved */
	task: Task;
	/** Pending subtasks were replaced by `generated` new ones */
	regenerated: boolean;
	/** Subtasks kept because work had started on them */
	preserved: number;
	generated: number;
	/** The report's score before, and after the re-score (MCP only) */
	complexity?: { before: number; after: number };
}

export interface ScopeTaskResult {
	tag: string;
	tasks: ScopedTask[];
	/** Every AI call's usage summed; null when none reported any */
	telemetryData: AggregatedTelemetry | null;
}

/** Subtasks the AI may rewrite: no work on them yet */
const isPending = (subtask: Subtask) =>
	!subtask.status || subtask.status === 'pending';

/** The fields the AI rewrote, leaving out any it returned empty */
type ScopedFields = Partial<
	Pick<Task, 'title' | 'description' | 'details' | 'testStrategy' | 'priority'>
>;

/** Strength and IDs, checked before anything is read or any AI call */
function parseInput(input: ScopeTaskInput): {
	strength: ScopeStrength;
	ids: string[];
} {
	const strength = (input.strength ?? 'regular') as ScopeStrength;
	if (!SCOPE_STRENGTHS.includes(strength)) {
		throw new TaskGraphError(
			`Invalid strength level: ${input.strength}. Must be one of: ${SCOPE_STRENGTHS.join(', ')}`,
			ERROR_CODES.VALIDATION_ERROR
		);
	}
	const ids = [
		...new Set(
			String(input.ids ?? '')
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean)
		)
	];
	if (ids.length === 0) {
		throw new TaskGraphError('No task ID given', ERROR_CODES.VALIDATION_ERROR);
	}
	for (const id of ids) {
		if (!/^\d+$/.test(id) || Number(id) === 0) {
			throw new TaskGraphError(
				/^\d+\.\d+$/.test(id)
					? `"${id}" is a subtask; scope-${input.direction} takes task IDs`
					: `Invalid task ID: ${id}`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
	}
	return { strength, ids: ids.map((id) => String(Number(id))) };
}

export class ScopeAdjustmentService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	async scope(
		input: ScopeTaskInput,
		hooks: ScopeTaskHooks = {}
	): Promise<ScopeTaskResult> {
		const { strength, ids } = parseInput(input);
		const { direction } = input;
		const { tasks, tag } = await this.taskService.loadStoredTasks(input.tag);
		// Every ID is checked before the first AI call
		for (const id of ids) {
			if (!tasks.some((t) => String(t.id) === id)) {
				throw new TaskGraphError(
					`Task with ID ${id} not found`,
					ERROR_CODES.TASK_NOT_FOUND
				);
			}
		}

		const warn = (message: string) => hooks.onWarning?.(message);
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const ai = new AiService(aiConfig.toHost());
		const call = (
			schema: unknown,
			objectName: string,
			prompts: { systemPrompt: string; prompt: string }
		) =>
			ai.generateObject({
				role: input.research ? 'research' : 'main',
				session: input.session,
				projectRoot: this.configManager.getProjectRoot(),
				schema,
				objectName,
				...prompts,
				commandName: `scope-${direction}`,
				outputType: input.outputType ?? 'cli'
			});

		const telemetry: AiTelemetryData[] = [];
		const done: ScopedTask[] = [];
		for (const id of ids) {
			try {
				// Read again: an earlier task's save or another command may have changed it
				const { tasks: current } = await this.taskService.loadStoredTasks(tag);
				const stored = current.find((t) => String(t.id) === id);
				if (!stored) {
					throw new TaskGraphError(
						`Task with ID ${id} not found`,
						ERROR_CODES.TASK_NOT_FOUND
					);
				}
				const before = this.reportScore(id, tag, warn);

				hooks.onAiCall?.({ taskId: id, step: 'task' });
				const adjusted = await call(
					ScopedTaskSchema,
					'updated_task',
					scopeTaskPrompt(stored, direction, strength, input.prompt)
				);
				if (adjusted?.telemetryData) telemetry.push(adjusted.telemetryData);
				const fields = scopedFields(adjusted?.mainResult);
				const task = { ...stored, ...fields } as Task;

				const generated = await this.regenerate(
					task,
					direction,
					strength,
					before?.score ?? null,
					(promptInput) => {
						hooks.onAiCall?.({ taskId: id, step: 'subtasks' });
						return call(
							RegeneratedSubtasksSchema,
							'subtask_regeneration',
							promptInput
						);
					},
					telemetry,
					warn
				);
				const saved = await this.save(
					stored,
					tag,
					task,
					generated,
					direction,
					warn
				);
				if (saved.dropped.length > 0) {
					warn(
						`Dropped dependencies on replaced subtasks of task ${id} from ${saved.dropped.join(', ')}`
					);
				}
				const scoped: ScopedTask = {
					task: saved.task,
					regenerated: generated !== null,
					preserved: saved.preserved,
					generated: generated?.length ?? 0
				};
				// The legacy CLI never re-scored (it had no session); MCP did
				if (input.session !== undefined && before) {
					const after = await this.rescore(
						id,
						tag,
						before.reportPath,
						input,
						telemetry,
						warn
					);
					if (after !== null) {
						scoped.complexity = { before: before.score, after };
					}
				}
				done.push(scoped);
			} catch (error) {
				// Tasks scoped before this one are saved; say so
				if (error instanceof Error && done.length > 0) {
					error.message += ` (task ${done.map((d) => d.task.id).join(', ')} already scoped ${direction})`;
				}
				throw error;
			}
		}

		return {
			tag,
			tasks: done,
			telemetryData: aggregateTelemetry(telemetry, `scope-${direction}`)
		};
	}

	/**
	 * New subtasks for the task's pending ones, numbered from 1 as the AI
	 * wrote them, or null when there is nothing to rewrite. A failed call is
	 * a warning: the task's own changes are still saved, as before.
	 */
	private async regenerate(
		task: Task,
		direction: ScopeDirection,
		strength: ScopeStrength,
		originalComplexity: number | null,
		callAi: (prompts: {
			systemPrompt: string;
			prompt: string;
		}) => Promise<AiServiceResult>,
		telemetry: AiTelemetryData[],
		warn: (message: string) => void
	): Promise<Subtask[] | null> {
		const subtasks = Array.isArray(task.subtasks) ? task.subtasks : [];
		const pendingCount = subtasks.filter(isPending).length;
		if (pendingCount === 0) return null;
		const preservedCount = subtasks.length - pendingCount;
		const target = targetSubtaskCount(
			direction,
			strength,
			preservedCount,
			pendingCount,
			originalComplexity
		);
		try {
			const response = await callAi(
				regenerateSubtasksPrompt(
					task,
					direction,
					strength,
					Math.max(1, target - preservedCount),
					preservedCount,
					originalComplexity
				)
			);
			if (response?.telemetryData) telemetry.push(response.telemetryData);
			const generated: any[] = response?.mainResult?.subtasks ?? [];
			// No subtasks back would delete every pending one
			if (generated.length === 0)
				throw new Error('the AI returned no subtasks');
			ensureSequentialSubtaskIds(generated);
			return generated.map((subtask) => ({
				...subtask,
				// New subtasks have no work on them, whatever the AI said
				status: 'pending',
				testStrategy: subtask.testStrategy || ''
			}));
		} catch (error) {
			warn(
				`Failed to regenerate subtasks for task ${task.id}: ${(error as Error).message}`
			);
			return null;
		}
	}

	/**
	 * Merge the new fields into the task as tasks.json has it now, under the
	 * lock, keeping edits made during the AI call (see mergeRewrite). The
	 * subtasks kept are the ones with work on them at save time; the new ones
	 * are numbered after every subtask the task had, so no ID is reused, and
	 * dependencies on the replaced ones are dropped.
	 */
	private async save(
		stored: Task,
		tag: string,
		updated: Task,
		generated: Subtask[] | null,
		direction: ScopeDirection,
		warn: (message: string) => void
	): Promise<{ task: Task; preserved: number; dropped: string[] }> {
		const id = String(stored.id);
		const { result } = await this.taskService.modifyTasks((current) => {
			const index = current.findIndex((t) => String(t.id) === id);
			if (index === -1) {
				throw new TaskGraphError(
					`Task ${id} was removed while it was being scoped ${direction}`,
					ERROR_CODES.TASK_NOT_FOUND
				);
			}
			const target = mergeRewrite(stored, updated, current[index], warn);
			current[index] = target;
			const all = target.subtasks ?? [];
			const kept = all.filter((s) => !isPending(s));
			let dropped: string[] = [];
			if (generated) {
				// New IDs come after every old one, so this can't hit a new subtask
				target.subtasks = [...kept, ...renumber(generated, all, target.id)];
				dropped = dropReferences(
					current,
					all.filter(isPending).map((s) => fullSubtaskId(target.id, s.id))
				);
			}
			return {
				tasks: current,
				result: { task: target, preserved: kept.length, dropped }
			};
		}, tag);
		return result;
	}

	/** The task's score in the tag's complexity report, if it has one */
	private reportScore(
		id: string,
		tag: string,
		warn: (message: string) => void
	): { score: number; reportPath: string } | null {
		try {
			const found = readComplexityReport(this.configManager.getProjectRoot(), {
				tag
			});
			const entry = found?.report.complexityAnalysis?.find(
				(a) => String(a.taskId) === id
			);
			return found && entry?.complexityScore
				? { score: entry.complexityScore, reportPath: found.reportPath }
				: null;
		} catch (error) {
			// A missing report returns null above; this one is there but unreadable
			warn(`${(error as Error).message}; scoping without its score`);
			return null;
		}
	}

	/** Re-score the saved task in the report; null (with a warning) when that fails */
	private async rescore(
		id: string,
		tag: string,
		reportPath: string,
		input: ScopeTaskInput,
		telemetry: AiTelemetryData[],
		warn: (message: string) => void
	): Promise<number | null> {
		try {
			const result = await new AnalyzeComplexityService(
				this.configManager
			).analyze(
				{
					ids: id,
					anyStatus: true,
					output: reportPath,
					tag,
					session: input.session,
					outputType: input.outputType
				},
				{ onWarning: warn }
			);
			if (result.telemetryData) telemetry.push(result.telemetryData);
			// This run's entry only: the report's older entry isn't a new score
			const entry = result.analyses.find((a) => String(a.taskId) === id);
			if (entry?.placeholder) {
				warn(
					`The AI returned no complexity analysis for task ${id}; its score was not updated`
				);
			} else if (entry) {
				return entry.complexityScore;
			} else {
				warn(`Could not find updated complexity analysis for task ${id}`);
			}
		} catch (error) {
			warn(`Failed to re-analyze task complexity: ${(error as Error).message}`);
		}
		return null;
	}
}

/** The AI's fields that hold something; a null or empty one keeps the stored value */
function scopedFields(
	result: Record<string, unknown> | undefined
): ScopedFields {
	const fields: Record<string, unknown> = {};
	for (const key of ['title', 'description', 'details', 'testStrategy']) {
		const value = result?.[key];
		if (typeof value === 'string' && value.trim()) fields[key] = value;
	}
	if (['low', 'medium', 'high'].includes(result?.priority as string)) {
		fields.priority = result?.priority;
	}
	return fields as ScopedFields;
}

/** The AI numbers its subtasks 1..n; anything else is refused */
function ensureSequentialSubtaskIds(subtasks: Array<{ id: unknown }>) {
	const ids = subtasks.map((subtask) => subtask.id);
	if (ids.some((id) => !Number.isInteger(id) || (id as number) < 1)) {
		throw new Error('Generated subtask ids must be positive integers');
	}
	if (new Set(ids).size !== ids.length) {
		throw new Error('Generated subtasks must have unique ids');
	}
	const sorted = [...(ids as number[])].sort((a, b) => a - b);
	if (sorted.some((id, index) => id !== index + 1)) {
		throw new Error('Generated subtask ids must be sequential starting from 1');
	}
}

/**
 * Number the new subtasks after `existing`, and point their "<task>.<n>"
 * sibling dependencies at the new numbers. The AI chose those dependencies,
 * so they are recorded as inferred.
 */
function renumber(
	generated: Subtask[],
	existing: Subtask[],
	taskId: Task['id']
): Subtask[] {
	let nextId =
		existing.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
	const idMapping = new Map<number, number>();
	const numbered = generated.map((subtask) => {
		const newId = nextId++;
		idMapping.set(Number(subtask.id), newId);
		return { ...subtask, id: newId };
	});
	return numbered.map((subtask) => {
		const remapped = {
			...subtask,
			dependencies: (subtask.dependencies ?? []).map((dep) => {
				if (typeof dep !== 'string' || !dep.startsWith(`${taskId}.`)) {
					return dep;
				}
				const sibling = idMapping.get(Number.parseInt(dep.split('.')[1], 10));
				return sibling ? `${taskId}.${sibling}` : dep;
			})
		} as Subtask;
		assignMetadata(
			remapped as never,
			reconcileDependencySources(remapped as never, undefined, taskId)
		);
		return remapped;
	});
}
