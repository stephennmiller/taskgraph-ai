/**
 * @fileoverview Expand a task into subtasks with the AI, and expand every
 * pending task (`expand --all`). The subtask count and prompt come from the
 * complexity report when it has the task. The AI call runs without the
 * tasks.json lock; the save re-reads the file under it and changes only the
 * expanded task's subtasks, so edits made during the call stay.
 *
 * The expand-task prompt is eval-gated: its inputs are built exactly as the
 * legacy scripts/modules/task-manager/expand-task.js built them.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { getLogger } from '../../../common/logger/index.js';
import type { Subtask, Task } from '../../../common/types/index.js';
import { mapWithConcurrency } from '../../../common/utils/map-with-concurrency.js';
import {
	type AggregatedTelemetry,
	aggregateTelemetry
} from '../../ai/aggregate-telemetry.js';
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
	complexityReportPath,
	withoutPlaceholders
} from '../../reports/managers/complexity-report-manager.js';
import {
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import { orderGeneratedSubtasks } from '../../dependencies/forward-dependencies.js';
import { removeAllSubtasks } from '../../dependencies/removed-references.js';
import {
	cleanGeneratedSubtaskDependencies,
	isSiblingReference,
	resolveSubtaskDependency
} from '../../dependencies/subtask-dependency.js';
import { getPrdSource } from '../../prd/prd-sections.js';
import { setGeneratedCriteria } from '../utils/acceptance-criteria.js';
import { TAG_NAME_PATTERN } from '../utils/tag-names.js';
import { degenerateReply } from './expand-reply-check.js';
import type { TaskService } from './task-service.js';

/**
 * Tasks expanded at once. Each expansion saves only the subtasks it added,
 * re-reading tasks.json under the file lock (#243), so parallel runs don't
 * undo each other's writes.
 */
const EXPAND_ALL_CONCURRENCY = 3;

/** How many related tasks the AI is shown, the expanded task included */
const MAX_RELATED_TASKS = 5;

export interface ExpandOptions {
	/** Subtasks to ask for; 0 lets the AI choose. Else the report's count, else defaultSubtasks */
	num?: number | string;
	/** Use the research role */
	research?: boolean;
	/** Extra context for the AI */
	prompt?: string;
	/** Replace existing subtasks instead of adding to them */
	force?: boolean;
	/** The tag's report in .taskgraph/reports when left out */
	complexityReportPath?: string;
	/** The active tag when left out */
	tag?: string;
	/** The MCP session, for its env */
	session?: unknown;
	/** 'cli' or 'mcp', for usage telemetry */
	outputType?: string;
}

export interface ExpandTaskInput extends ExpandOptions {
	/** A top-level task ID */
	id: string | number;
	/**
	 * MCP expand_task's rules: refuse a done task, and leave a task that
	 * already has subtasks as it is unless `force`
	 */
	keepExpanded?: boolean;
}

/** Calls made while a task is expanded, so a caller can show progress */
export interface ExpandTaskHooks {
	/** A heads-up, such as a complexity report that doesn't parse */
	onWarning?: (message: string) => void;
	/** AI service detail, sent only with `global.debug` on */
	onDebug?: (message: string) => void;
	/** The AI call is about to start; 0 subtasks means the AI picks how many */
	onAiCall?: (context: { taskId: string; subtaskCount: number }) => void;
}

export interface ExpandTaskResult {
	/** The task as saved (as found, when skipped) */
	task: Task;
	tag: string;
	/** The new subtasks only */
	addedSubtasks: Subtask[];
	/**
	 * Why nothing was added: the complexity report recommends no subtasks,
	 * or the task has some already (keepExpanded)
	 */
	skipped?: 'complexity-report' | 'has-subtasks';
	/** The task had subtasks before; with force they were replaced */
	hadSubtasks: boolean;
	telemetryData: AiTelemetryData | null;
	tagInfo: AiTagInfo | null;
}

export interface ExpandAllHooks
	extends Pick<ExpandTaskHooks, 'onWarning' | 'onDebug'> {
	/** The tasks that will be expanded are known */
	onStart?: (taskIds: string[]) => void;
	/** One task finished: its result, or why it failed */
	onTaskDone?: (taskId: string, outcome: ExpandTaskResult | Error) => void;
}

export interface ExpandAllResult {
	tag: string;
	/** Tasks that got new subtasks */
	expandedCount: number;
	/** Tasks the complexity report says need no subtasks */
	skippedCount: number;
	failedCount: number;
	/** Pending or in-progress tasks without subtasks (any, with force) */
	tasksToExpand: number;
	/** Pending or in-progress tasks left out because they have subtasks */
	alreadyExpandedCount: number;
	/** The calls' usage summed; null when no call reported any */
	telemetryData: AggregatedTelemetry | null;
}

/** The parts of a complexity report entry expand reads */
interface TaskAnalysis {
	taskId: number | string;
	recommendedSubtasks?: number | string | null;
	expansionPrompt?: string | { text?: string };
	reasoning?: string;
	placeholder?: boolean;
}

const logger = getLogger('ExpandTask');

/** Report names the legacy MCP tools also looked for, after the default */
const LEGACY_REPORT_NAMES = ['task-complexity', 'complexity-report'];

/** An expansion that failed after its AI call, with that call's usage */
interface ExpandError extends Error {
	telemetryData?: AiTelemetryData | null;
}

/** `num` as a count, undefined when not given; anything but 0 or more is refused */
function explicitCount(num: ExpandOptions['num']): number | undefined {
	if (num === undefined || num === null || String(num).trim() === '') {
		return undefined;
	}
	if (!/^\d+$/.test(String(num).trim())) {
		throw new TaskGraphError(
			`${JSON.stringify(String(num))} isn't a number of subtasks; use 0 or more`,
			ERROR_CODES.VALIDATION_ERROR
		);
	}
	return Number(String(num).trim());
}

/**
 * Number the new subtasks on from the highest ID the task has now, and point
 * their dependencies on each other at the new IDs. The AI call ran without
 * the lock, so another writer may have added a subtask meanwhile (#569).
 */
function renumberSubtasks(
	taskId: string,
	existing: Subtask[],
	added: Subtask[]
): void {
	// A subtask may be stored as "3.2" rather than 2
	const highest = Math.max(
		0,
		...existing.map((s) => Number(String(s.id).split('.').pop()) || 0)
	);
	// A repeated AI ID gets its own new ID; a reference to it means the first
	const newIds = new Map<string, number>();
	added.forEach((s, i) => {
		if (!newIds.has(String(s.id))) newIds.set(String(s.id), highest + i + 1);
	});
	added.forEach((subtask, i) => {
		subtask.id = String(highest + i + 1);
		subtask.dependencies = (subtask.dependencies ?? []).map((raw) => {
			const dep = resolveSubtaskDependency(taskId, raw);
			const newId = dep.startsWith(`${taskId}.`)
				? newIds.get(dep.slice(taskId.length + 1))
				: undefined;
			if (newId === undefined) return raw;
			return typeof raw === 'number' && isSiblingReference(newId)
				? newId
				: `${taskId}.${newId}`;
		});
		// The inferred marks are keyed by dependency ID
		assignMetadata(
			subtask,
			reconcileDependencySources(subtask, undefined, taskId)
		);
	});
}

export class ExpandTaskService {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	async expand(
		input: ExpandTaskInput,
		hooks: ExpandTaskHooks = {}
	): Promise<ExpandTaskResult> {
		const taskId = String(input.id).trim();
		if (!/^\d+$/.test(taskId)) {
			throw new TaskGraphError(
				`"${taskId}" isn't a task ID; expand takes a task, not a subtask`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
		const num = explicitCount(input.num);
		const { tasks, tag } = await this.taskService.loadStoredTasks(input.tag);
		const stored = tasks.find((t) => String(t.id) === taskId);
		if (!stored) {
			throw new TaskGraphError(
				`Task ${taskId} not found`,
				ERROR_CODES.TASK_NOT_FOUND
			);
		}
		const hadSubtasks = (stored.subtasks?.length ?? 0) > 0;
		const skip = (skipped: ExpandTaskResult['skipped']): ExpandTaskResult => ({
			task: stored,
			tag,
			addedSubtasks: [],
			skipped,
			hadSubtasks,
			telemetryData: null,
			tagInfo: null
		});
		if (input.keepExpanded) {
			if (stored.status === 'done') {
				throw new TaskGraphError(
					`Task ${taskId} is already marked as done and cannot be expanded`,
					ERROR_CODES.TASK_STATUS_ERROR
				);
			}
			if (hadSubtasks && !input.force) return skip('has-subtasks');
		}

		// force: the prompt and the search see the task without its subtasks
		const task: Task =
			input.force && hadSubtasks ? { ...stored, subtasks: [] } : stored;
		const warn = (message: string) => hooks.onWarning?.(message);
		const aiConfig = new AiConfig(this.configManager, (level, message) =>
			level === 'warn' ? warn(message) : hooks.onDebug?.(message)
		);
		const analysis = this.readAnalysis(
			task,
			tag,
			input.complexityReportPath,
			warn
		);
		const subtaskCount = this.subtaskCount(num, analysis, aiConfig, warn);
		if (subtaskCount === null) return skip('complexity-report');

		const useResearch = input.research === true;
		const projectRoot = this.configManager.getProjectRoot();
		const expansionPrompt =
			(typeof analysis?.expansionPrompt === 'string'
				? analysis.expansionPrompt
				: analysis?.expansionPrompt?.text) || undefined;
		const { systemPrompt, userPrompt } = getPromptManager().loadPrompt(
			'expand-task',
			{
				task,
				subtaskCount,
				nextSubtaskId: (task.subtasks?.length || 0) + 1,
				additionalContext: input.prompt || '',
				complexityReasoningContext: analysis?.reasoning
					? `\nComplexity Analysis Reasoning: ${analysis.reasoning}`
					: '',
				gatheredContext: await this.gatherContext(
					tasks.map((t) => (t === stored ? task : t)),
					tasks,
					task,
					warn
				),
				useResearch,
				expansionPrompt,
				hasCodebaseAnalysis: aiConfig.hasCodebaseAnalysis(
					useResearch,
					input.session
				),
				projectRoot: projectRoot || ''
			},
			expansionPrompt
				? 'complexity-report'
				: useResearch
					? 'research'
					: 'default'
		);

		hooks.onAiCall?.({ taskId, subtaskCount });
		const callAi = () =>
			new AiService(aiConfig.toHost()).generateObject({
				role: useResearch ? 'research' : 'main',
				session: input.session,
				projectRoot,
				schema: COMMAND_SCHEMAS['expand-task'],
				objectName: 'subtasks',
				systemPrompt,
				prompt: userPrompt,
				commandName: 'expand-task',
				outputType: input.outputType ?? 'cli'
			});
		let response = await callAi();
		const firstProblem = degenerateReply(
			response?.mainResult?.subtasks,
			subtaskCount
		);
		if (firstProblem) {
			// A stub reply is a bad draw, not the task: ask once more
			warn(`Task ${taskId}: the AI returned ${firstProblem}; asking again`);
			const first = response?.telemetryData;
			try {
				response = await callAi();
			} catch (error) {
				// The first call was paid for even though the retry failed
				if (error instanceof Error && first) {
					(error as ExpandError).telemetryData = first;
				}
				throw error;
			}
			const second = response?.telemetryData;
			if (first && second) {
				response.telemetryData = {
					...second,
					...aggregateTelemetry([first, second], 'expand-task'),
					isUnknownCost: first.isUnknownCost || second.isUnknownCost
				};
			}
		}
		let saved: Task;
		let addedSubtasks: Subtask[];
		try {
			const generated = response?.mainResult?.subtasks;
			if (!Array.isArray(generated)) {
				throw new Error('AI response did not include a valid subtasks array.');
			}
			// Saving none would leave the task as it was, or with force, empty it
			if (generated.length === 0) {
				throw new TaskGraphError(
					`The AI returned no subtasks for task ${taskId}; the task was left as it was`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			const problem = degenerateReply(generated, subtaskCount);
			if (problem) {
				throw new TaskGraphError(
					`Task ${taskId}: the AI returned ${problem}, twice; the task was left as it was. Run expand again, or give it more context with a prompt`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			addedSubtasks = this.prepareSubtasks(task, generated, (message) => {
				logger.debug(message);
				if (aiConfig.debug) hooks.onDebug?.(message);
			});
			saved = await this.save(taskId, tag, addedSubtasks, input.force === true);
		} catch (error) {
			// The call was made and paid for, even though nothing was saved
			if (error instanceof Error) {
				(error as ExpandError).telemetryData = response?.telemetryData;
			}
			throw error;
		}

		return {
			task: saved,
			tag,
			addedSubtasks,
			hadSubtasks,
			telemetryData: response.telemetryData,
			tagInfo: response.tagInfo
		};
	}

	/**
	 * Add the subtasks to the task as tasks.json has it now, under the lock;
	 * with force, in place of the ones it has
	 */
	private async save(
		taskId: string,
		tag: string,
		addedSubtasks: Subtask[],
		force: boolean
	): Promise<Task> {
		const { result } = await this.taskService.modifyTasks((current) => {
			const target = current.find((t) => String(t.id) === taskId);
			if (!target) {
				throw new TaskGraphError(
					`Task ${taskId} was removed while it was being expanded`,
					ERROR_CODES.TASK_NOT_FOUND
				);
			}
			// force replaces what is there, first dropping dependencies and links
			// on the old subtasks: the new ones reuse their IDs
			if (force) removeAllSubtasks(current as never, target as never);
			if (!Array.isArray(target.subtasks)) target.subtasks = [];
			renumberSubtasks(taskId, target.subtasks, addedSubtasks);
			target.subtasks.push(...addedSubtasks);
			return { tasks: current, result: target };
		}, tag);
		return result;
	}

	/**
	 * Expand every pending or in-progress task without subtasks (with force,
	 * with them too), a few at a time. A task that fails is counted and the
	 * rest go on.
	 */
	async expandAll(
		options: ExpandOptions,
		hooks: ExpandAllHooks = {}
	): Promise<ExpandAllResult> {
		// A bad count would fail every task the same way
		explicitCount(options.num);
		const { tasks, tag } = await this.taskService.loadStoredTasks(options.tag);
		const open = tasks.filter(
			(t) => t.status === 'pending' || t.status === 'in-progress'
		);
		const eligible = open.filter(
			(t) => !t.subtasks || t.subtasks.length === 0 || options.force
		);
		const result: ExpandAllResult = {
			tag,
			expandedCount: 0,
			skippedCount: 0,
			failedCount: 0,
			tasksToExpand: eligible.length,
			alreadyExpandedCount: options.force ? 0 : open.length - eligible.length,
			telemetryData: null
		};
		if (eligible.length === 0) return result;

		hooks.onStart?.(eligible.map((t) => String(t.id)));
		const telemetry: AiTelemetryData[] = [];
		await mapWithConcurrency(eligible, EXPAND_ALL_CONCURRENCY, async (task) => {
			const id = String(task.id);
			let outcome: ExpandTaskResult | Error;
			try {
				outcome = await this.expand({ ...options, id, tag }, hooks);
				if (outcome.skipped) {
					result.skippedCount++;
				} else {
					result.expandedCount++;
					if (outcome.telemetryData) telemetry.push(outcome.telemetryData);
				}
			} catch (error) {
				result.failedCount++;
				outcome = error instanceof Error ? error : new Error(String(error));
				const spent = (outcome as ExpandError).telemetryData;
				if (spent) telemetry.push(spent);
			}
			// Outside the try: a hook that throws must not count the task twice
			hooks.onTaskDone?.(id, outcome);
		});
		result.telemetryData = aggregateTelemetry(telemetry, 'expand-all-tasks');
		return result;
	}

	/** The report's entry for the task, if the report exists and has one */
	private readAnalysis(
		task: Task,
		tag: string,
		reportPath: string | undefined,
		warn: (message: string) => void
	): TaskAnalysis | undefined {
		let file = reportPath;
		if (file === undefined) {
			// An invalid stored tag has no report
			if (!TAG_NAME_PATTERN.test(tag)) return undefined;
			const suffix = tag === 'master' ? '.json' : `_${tag}.json`;
			const defaultFile = complexityReportPath(
				this.configManager.getProjectRoot(),
				tag
			);
			file = [
				defaultFile,
				...LEGACY_REPORT_NAMES.map((name) =>
					path.join(path.dirname(defaultFile), `${name}${suffix}`)
				)
			].find((candidate) => fs.existsSync(candidate));
			if (!file) return undefined;
		}
		try {
			if (!fs.existsSync(file)) {
				warn(`Complexity report ${file} not found. Proceeding without it.`);
				return undefined;
			}
			const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
			const entries: TaskAnalysis[] = report?.complexityAnalysis ?? [];
			return withoutPlaceholders(entries).find(
				(a) => String(a.taskId) === String(task.id)
			);
		} catch (error) {
			warn(
				`Could not read or parse complexity report: ${(error as Error).message}. Proceeding without it.`
			);
			return undefined;
		}
	}

	/**
	 * Subtasks to ask for: `num` (0 or more), else the report's count, else
	 * defaultSubtasks. Null when the report recommends none, which skips the
	 * task; an explicit 0 instead lets the AI choose.
	 */
	private subtaskCount(
		explicit: number | undefined,
		analysis: TaskAnalysis | undefined,
		aiConfig: AiConfig,
		warn: (message: string) => void
	): number | null {
		let count: number;
		if (explicit !== undefined) {
			count = explicit;
		} else if (analysis?.recommendedSubtasks != null) {
			count = parseInt(String(analysis.recommendedSubtasks), 10);
			if (count === 0) return null;
		} else {
			count = aiConfig.defaultSubtasks;
		}
		if (Number.isNaN(count) || count < 0) {
			warn(`Invalid subtask count determined (${count}), defaulting to 3.`);
			return 3;
		}
		return count;
	}

	/**
	 * The related tasks for the prompt. The search runs over `searchTasks`
	 * (the expanded task without its subtasks under force) and the context
	 * shows the tasks as stored, as the legacy command read them twice.
	 */
	private async gatherContext(
		searchTasks: Task[],
		storedTasks: Task[],
		task: Task,
		warn: (message: string) => void
	): Promise<string> {
		try {
			const related = await findRelatedTaskIds(
				searchTasks,
				`${task.title} ${task.description}`,
				MAX_RELATED_TASKS
			);
			return formatTasksContext(storedTasks, [
				...new Set([String(task.id), ...related])
			]);
		} catch (error) {
			warn(`Could not gather context: ${(error as Error).message}`);
			return '';
		}
	}

	/** The AI's subtasks, ordered and ready to store */
	private prepareSubtasks(
		task: Task,
		generated: any[],
		debug: (message: string) => void
	): Subtask[] {
		// No subtask waits on a later sibling or on a task its parent doesn't
		const ordered = orderGeneratedSubtasks(
			task,
			generated.map((subtask) => ({
				...subtask,
				dependencies: cleanGeneratedSubtaskDependencies(
					subtask.dependencies,
					task.id
				)
			})),
			debug
		);
		const source = getPrdSource(task);
		return ordered.map((subtask) => {
			// The AI's criteria are stored as unchecked items (none: no field)
			const prepared = setGeneratedCriteria({
				...subtask,
				status: subtask.status ?? 'pending',
				testStrategy: subtask.testStrategy ?? null
			});
			// The AI chose these dependencies, so record them as inferred
			assignMetadata(
				prepared,
				reconcileDependencySources(prepared, undefined, task.id)
			);
			// A subtask comes from the same PRD section as its task
			if (source) prepared.metadata = { ...prepared.metadata, source };
			return prepared as unknown as Subtask;
		});
	}
}
