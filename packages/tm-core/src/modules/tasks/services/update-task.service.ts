/**
 * @fileoverview Rewrite tasks with the AI from a prompt: one task
 * (`update-task`, or with `append` a timestamped note added to its details)
 * and every unfinished task from an ID on (`update --from`). The AI call
 * runs without the tasks.json lock; the save re-reads the file under it and
 * applies only what the rewrite changed, so edits made during the call stay.
 *
 * The prompt inputs are built as the legacy
 * scripts/modules/task-manager/update-task-by-id.js and update-tasks.js
 * built them.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import {
	AiService,
	type AiTagInfo,
	type AiTelemetryData
} from '../../ai/ai-service.js';
import { AiConfig } from '../../ai/config-ai-host.js';
import { getPromptManager } from '../../ai/prompts/prompt-manager.js';
import { COMMAND_SCHEMAS } from '../../ai/schemas/registry.js';
import {
	findRelatedTaskIds,
	formatTasksContext
} from '../../ai/task-context.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import {
	assignMetadata,
	reconcileDependencySources,
	withoutReservedMetadata
} from '../../dependencies/dependency-provenance.js';
import { keepStoredFields } from '../utils/stored-fields.js';
import type { TaskService } from './task-service.js';
import {
	aiDependencies,
	keepDoneSubtasks,
	keepStatus,
	mergeRewrite,
	promptView,
	removedError,
	rewriteSubtasks,
	settleRewrites,
	taskIdOf
} from './update-task-helpers.js';

/** How many related tasks the AI is shown besides the ones it rewrites */
const MAX_RELATED_TASKS = 5;

interface UpdateBase {
	/** Use the research role */
	research?: boolean;
	/** The active tag when left out */
	tag?: string;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

export interface UpdateTaskInput extends UpdateBase {
	/** A top-level task ID */
	id: string | number;
	/** What changed; may be empty only when `metadata` is given */
	prompt?: string;
	/** Add the AI's text to the details instead of rewriting the task */
	append?: boolean;
	/** Merged into the task's metadata (the reserved keys are ignored) */
	metadata?: Record<string, unknown> | null;
}

export interface UpdateFromInput extends UpdateBase {
	/** Tasks with this ID or higher that aren't done are rewritten */
	from: string | number;
	prompt: string;
}

export interface UpdateHooks {
	/** A heads-up, such as a status the AI changed back */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start on these tasks */
	onAiCall?: (tasks: Task[]) => void;
}

export interface UpdateTaskResult {
	/** The task as saved (as found, when skipped) */
	task: Task;
	tag: string;
	/** A done task is left as it is */
	skipped?: 'done';
	/** With `append`: the text added, empty when the AI returned none */
	appended?: string;
	/** Null when no AI call was made (metadata only, or skipped) */
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
}

export interface UpdateFromResult {
	tag: string;
	/** Tasks sent to the AI: from `from` on, not done; 0 makes no call */
	sentCount: number;
	/** The rewritten tasks as saved, in file order */
	updatedTasks: Task[];
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
}
export class UpdateTaskService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	async updateTask(
		input: UpdateTaskInput,
		hooks: UpdateHooks = {}
	): Promise<UpdateTaskResult> {
		const taskId = taskIdOf(
			input.id,
			String(input.id).includes('.')
				? 'Update subtasks with `taskgraph update-subtask`'
				: 'Use a number like `3`'
		);
		const prompt = input.prompt ?? '';
		const metadata = withoutReservedMetadata(input.metadata);
		if (prompt.trim() === '' && !metadata) {
			throw new TaskGraphError(
				'Prompt cannot be empty unless metadata is provided for update.',
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		const { tasks, tag } = await this.loadTag(input.tag);
		const stored = tasks.find((t) => String(t.id) === taskId);
		if (!stored) {
			throw new TaskGraphError(
				`Task ${taskId} not found`,
				ERROR_CODES.TASK_NOT_FOUND
			);
		}
		const result = (task: Task): UpdateTaskResult => ({
			task,
			tag,
			telemetryData: null,
			tagInfo: null
		});
		if (stored.status === 'done') return { ...result(stored), skipped: 'done' };
		const mergeMetadata = (task: Task) => {
			if (metadata) task.metadata = { ...(task.metadata || {}), ...metadata };
		};
		// Metadata only: no AI call
		if (prompt.trim() === '') {
			return result(await this.patch(taskId, tag, mergeMetadata));
		}

		const warn = (message: string) => hooks.onWarning?.(message);
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const useResearch = input.research === true;
		const append = input.append === true;
		const projectRoot = this.configManager.getProjectRoot();
		const view = promptView(stored);
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'update-task',
			{
				task: view,
				taskJson: JSON.stringify(view, null, 2),
				updatePrompt: prompt,
				appendMode: append,
				useResearch,
				currentDetails: stored.details || '(No existing details)',
				gatheredContext: await this.gatherContext(
					tasks,
					`${stored.title} ${stored.description} ${prompt}`,
					[taskId],
					warn
				),
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
					useResearch,
					input.session
				),
				projectRoot
			},
			// The default prompt has the research wording; there is no research variant
			append ? 'append' : 'default'
		);

		hooks.onAiCall?.([stored]);
		const request = {
			role: useResearch ? 'research' : 'main',
			session: input.session,
			projectRoot,
			systemPrompt,
			prompt: userPrompt,
			commandName: 'update-task',
			outputType: input.outputType ?? 'cli'
		};
		const ai = new AiService(aiConfig.toHost());
		if (append) {
			const response = await ai.generateText(request);
			const text =
				typeof response.mainResult === 'string'
					? response.mainResult.trim()
					: '';
			// Nothing to add leaves the task as it was, apart from metadata
			const saved = await this.patch(taskId, tag, (task) => {
				if (text) {
					const at = new Date().toISOString();
					const block = `<info added on ${at}>\n${text}\n</info added on ${at}>`;
					task.details = (task.details ? `${task.details}\n` : '') + block;
					if (prompt.length < 100 && task.description) {
						task.description += ` [Updated: ${new Date().toLocaleDateString()}]`;
					}
				}
				mergeMetadata(task);
			});
			return {
				...result(saved),
				appended: text,
				telemetryData: response.telemetryData,
				tagInfo: response.tagInfo
			};
		}

		const response = await ai.generateObject({
			...request,
			schema: COMMAND_SCHEMAS['update-task-by-id'],
			objectName: 'task'
		});
		const debug = (message: string) => {
			if (aiConfig.debug) hooks.onDebug?.(message);
		};
		const { updated, relabel } = this.rewrite(
			stored,
			response.mainResult?.task,
			prompt,
			metadata,
			warn,
			debug
		);
		const { result: saved } = await this.taskService.modifyTasks((current) => {
			const index = current.findIndex((t) => String(t.id) === taskId);
			if (index === -1) throw removedError(taskId);
			const now = relabel(current[index]);
			const merged = mergeRewrite(stored, updated, now, warn);
			current[index] = merged;
			settleRewrites(current, [{ stored, now, saved: merged }], debug);
			return { tasks: current, result: merged };
		}, tag);
		return {
			...result(saved),
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}

	/**
	 * The tag's tasks. A tag tasks.json lacks fails, master included (the
	 * loader reads a missing master as empty), unless the file has no tags yet
	 */
	private async loadTag(tag?: string) {
		const loaded = await this.taskService.loadStoredTasks(tag);
		if (loaded.tasks.length === 0) {
			const tags = await this.taskService.getStorage().getAllTags();
			if (tags.length > 0 && !tags.includes(loaded.tag)) {
				throw new TaskGraphError(
					`Tag "${loaded.tag}" not found`,
					ERROR_CODES.NOT_FOUND
				);
			}
		}
		return loaded;
	}

	/** Change one task as tasks.json has it now, under the lock */
	private async patch(
		taskId: string,
		tag: string,
		change: (task: Task) => void
	): Promise<Task> {
		const { result } = await this.taskService.modifyTasks((current) => {
			const task = current.find((t) => String(t.id) === taskId);
			if (!task) throw removedError(taskId);
			change(task);
			return { tasks: current, result: task };
		}, tag);
		return result;
	}

	/**
	 * The AI's rewrite of `stored`, ready to save: its ID and status kept
	 * (status unless the prompt mentions it), each subtask under the ID of
	 * the stored one it matches (see rewriteSubtasks), done subtasks restored,
	 * and every field the AI left out or nulled kept. `relabel` gives a copy of
	 * the task as saved since with a subtask added during the call moved off
	 * an ID the rewrite gave a new one
	 */
	private rewrite(
		stored: Task,
		aiTask: any,
		prompt: string,
		metadata: Record<string, unknown> | undefined,
		warn: (message: string) => void,
		debug: (message: string) => void
	): { updated: Task; relabel: (task: Task) => Task } {
		if (!aiTask || typeof aiTask !== 'object') {
			throw new Error('Received invalid task object from AI.');
		}
		const updated = {
			...aiTask,
			dependencies: aiDependencies(aiTask.dependencies, stored),
			priority: aiTask.priority ?? null,
			details: aiTask.details ?? null,
			testStrategy: aiTask.testStrategy ?? null
		};
		if (!updated.title || !updated.description) {
			throw new Error('Updated task missing required fields.');
		}
		// Routine: the model often renumbers
		if (String(updated.id) !== String(stored.id)) {
			debug(`AI changed task ID. Restoring original ID ${stored.id}.`);
		}
		updated.id = stored.id;
		keepStatus(stored, updated, prompt, warn);
		const original = stored.subtasks ?? [];
		let relabel = (task: Task) => task;
		if (Array.isArray(updated.subtasks)) {
			// Matched subtasks keep their stored IDs, so dependencies on them from
			// other tasks still name them (#804); new ones get the next free ID
			const { subtasks, newIds } = rewriteSubtasks(stored, updated.subtasks);
			updated.subtasks = subtasks;
			const ids = subtasks.map((st) => st.id);
			// A subtask added during the call under an ID a new one took moves on
			relabel = (task) => {
				if (!Array.isArray(task.subtasks)) return task;
				let free = Math.max(
					0,
					...[...ids, ...task.subtasks.map((st) => st.id)]
						.map(Number)
						.filter(Number.isInteger)
				);
				return {
					...task,
					subtasks: task.subtasks.map((st) =>
						newIds.has(String(st.id)) ? { ...st, id: String(++free) } : st
					)
				};
			};
		}
		if (original.length > 0) {
			if (!updated.subtasks) {
				warn('Subtasks removed by AI. Restoring original subtasks.');
				updated.subtasks = original;
			} else {
				updated.subtasks = keepDoneSubtasks(original, updated.subtasks, warn);
			}
		}
		// The schema has only some fields and sends null for the ones the AI
		// has nothing to say about; keep the stored value of each
		keepStoredFields(updated, stored);
		// Dependencies the AI added are inferred (earlier marks stay), plus
		// the caller's metadata
		const marks = reconcileDependencySources(updated, stored);
		assignMetadata(
			updated,
			marks || metadata ? { ...(marks || {}), ...(metadata || {}) } : undefined
		);
		return { updated: updated as Task, relabel };
	}

	/**
	 * Rewrite every task from `from` on that isn't done, in one AI call. Only
	 * the tasks sent may change; others the AI returns are ignored.
	 */
	async updateFrom(
		input: UpdateFromInput,
		hooks: UpdateHooks = {}
	): Promise<UpdateFromResult> {
		// 0 updates every task, as the legacy command did
		const from = Number(
			taskIdOf(input.from, 'Use a number like `--from=3`', true)
		);
		const prompt = input.prompt ?? '';
		if (prompt.trim() === '') {
			throw new TaskGraphError(
				'Update prompt is required',
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		const { tasks, tag } = await this.loadTag(input.tag);
		const toUpdate = tasks.filter(
			(t) => Number(t.id) >= from && t.status !== 'done'
		);
		const result: UpdateFromResult = {
			tag,
			sentCount: toUpdate.length,
			updatedTasks: [],
			telemetryData: null,
			tagInfo: null
		};
		if (toUpdate.length === 0) return result;

		const warn = (message: string) => hooks.onWarning?.(message);
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const debug = (message: string) => {
			if (aiConfig.debug) hooks.onDebug?.(message);
		};
		const useResearch = input.research === true;
		const projectRoot = this.configManager.getProjectRoot();
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'update-tasks',
			{
				tasks: toUpdate.map(promptView),
				updatePrompt: prompt,
				useResearch,
				projectContext: await this.gatherContext(
					tasks,
					prompt,
					toUpdate.map((t) => String(t.id)),
					warn
				),
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
					useResearch,
					input.session
				),
				projectRoot
			}
		);

		hooks.onAiCall?.(toUpdate);
		const response = await new AiService(aiConfig.toHost()).generateObject({
			role: useResearch ? 'research' : 'main',
			session: input.session,
			projectRoot,
			systemPrompt,
			prompt: userPrompt,
			schema: COMMAND_SCHEMAS['update-tasks'],
			objectName: 'tasks',
			commandName: 'update-tasks',
			outputType: input.outputType ?? 'cli'
		});
		const returned = response.mainResult?.tasks;
		if (!Array.isArray(returned)) {
			throw new Error('Parsed AI response for updated tasks was not an array.');
		}
		debug(`Received ${returned.length} updated tasks from AI.`);
		const byId = new Map<string, any>(returned.map((t) => [String(t.id), t]));
		// The model may return tasks it was never sent; only those sent change
		const rewritten = new Map<string, { stored: Task; updated: Task }>();
		const missing: string[] = [];
		for (const task of toUpdate) {
			const ai = byId.get(String(task.id));
			if (!ai) {
				missing.push(String(task.id));
				continue;
			}
			rewritten.set(String(task.id), {
				stored: task,
				updated: this.rewriteOne(task, ai, prompt, (message) =>
					warn(`Task ${task.id}: ${message}`)
				)
			});
		}
		if (missing.length > 0) {
			warn(
				`The AI didn't return ${missing.length === 1 ? 'task' : 'tasks'} ${missing.join(', ')}, so ${missing.length === 1 ? 'it was' : 'they were'} left as ${missing.length === 1 ? 'it was' : 'they were'}`
			);
		}

		const { result: saved } = await this.taskService.modifyTasks((current) => {
			const done: Array<{ stored: Task; now: Task; saved: Task }> = [];
			for (const [id, { stored, updated }] of rewritten) {
				const index = current.findIndex((t) => String(t.id) === id);
				if (index === -1) {
					warn(`Task ${id} was removed while it was being updated`);
					continue;
				}
				const now = current[index];
				current[index] = mergeRewrite(stored, updated, now, warn);
				done.push({ stored, now, saved: current[index] });
			}
			settleRewrites(current, done, debug);
			return {
				tasks: done.length ? current : null,
				result: done.map(({ saved }) => saved)
			};
		}, tag);
		debug(`Applied updates to ${saved.length} tasks in the dataset.`);
		return {
			...result,
			updatedTasks: saved,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}

	/**
	 * One task of an `update --from` reply merged onto the stored task, with
	 * its status (unless the prompt mentions it) and done subtasks kept
	 */
	private rewriteOne(
		task: Task,
		ai: any,
		prompt: string,
		warn: (message: string) => void
	): Task {
		const merged = keepStoredFields(
			{
				...task,
				...ai,
				id: task.id,
				dependencies: aiDependencies(ai.dependencies, task),
				priority: ai.priority ?? null,
				details: ai.details ?? null,
				testStrategy: ai.testStrategy ?? null,
				// Each subtask keeps the ID of the stored one it matches, so the
				// save and the restores below follow it when the AI renumbers
				// (#576); a new one gets the next free ID
				subtasks: Array.isArray(ai.subtasks)
					? rewriteSubtasks(task, ai.subtasks).subtasks
					: null
			},
			task
		) as Task;
		// Dependencies the AI added are recorded as inferred; earlier marks stay
		assignMetadata(merged, reconcileDependencySources(merged, task));
		if (Array.isArray(merged.subtasks) && task.subtasks?.length) {
			merged.subtasks = keepDoneSubtasks(task.subtasks, merged.subtasks, warn);
		}
		keepStatus(task, merged, prompt, warn);
		return merged;
	}

	/** The tasks related to `query`, after `ids`, as the prompt shows them */
	private async gatherContext(
		tasks: Task[],
		query: string,
		ids: string[],
		warn: (message: string) => void
	): Promise<string> {
		try {
			const related = await findRelatedTaskIds(tasks, query, MAX_RELATED_TASKS);
			return formatTasksContext(tasks, [...new Set([...ids, ...related])]);
		} catch (error) {
			warn(`Could not gather context: ${(error as Error).message}`);
			return '';
		}
	}
}
