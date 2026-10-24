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
import { COMPLEXITY_REPORT_FILE } from '../../../common/constants/paths.js';
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
	assignMetadata,
	reconcileDependencySources
} from '../../dependencies/dependency-provenance.js';
import { orderGeneratedSubtasks } from '../../dependencies/forward-dependencies.js';
import { removeAllSubtasks } from '../../dependencies/removed-references.js';
import { cleanGeneratedSubtaskDependencies } from '../../dependencies/subtask-dependency.js';
import { getPrdSource } from '../../prd/prd-sections.js';
import { setGeneratedCriteria } from '../utils/acceptance-criteria.js';
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
}

const logger = getLogger('ExpandTask');

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
		const subtaskCount = this.subtaskCount(input.num, analysis, aiConfig, warn);
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
		const response = await new AiService(aiConfig.toHost()).generateObject({
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
		const generated = response?.mainResult?.subtasks;
		if (!Array.isArray(generated)) {
			throw new Error('AI response did not include a valid subtasks array.');
		}
		const addedSubtasks = this.prepareSubtasks(task, generated);

		const { result: saved } = await this.taskService.modifyTasks((current) => {
			const target = current.find((t) => String(t.id) === taskId);
			if (!target) {
				throw new TaskGraphError(
					`Task ${taskId} was removed while it was being expanded`,
					ERROR_CODES.TASK_NOT_FOUND
				);
			}
			// force replaces what is there, first dropping dependencies and links
			// on the old subtasks: the new ones reuse their IDs
			if (input.force) removeAllSubtasks(current as never, target as never);
			if (!Array.isArray(target.subtasks)) target.subtasks = [];
			target.subtasks.push(...addedSubtasks);
			return { tasks: current, result: target };
		}, tag);

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
	 * Expand every pending or in-progress task without subtasks (with force,
	 * with them too), a few at a time. A task that fails is counted and the
	 * rest go on.
	 */
	async expandAll(
		options: ExpandOptions,
		hooks: ExpandAllHooks = {}
	): Promise<ExpandAllResult> {
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
			alreadyExpandedCount: options.force
				? 0
				: open.length - eligible.length,
			telemetryData: null
		};
		if (eligible.length === 0) return result;

		hooks.onStart?.(eligible.map((t) => String(t.id)));
		const telemetry: AiTelemetryData[] = [];
		await mapWithConcurrency(eligible, EXPAND_ALL_CONCURRENCY, async (task) => {
			const id = String(task.id);
			try {
				const expanded = await this.expand({ ...options, id, tag }, hooks);
				if (expanded.skipped) {
					result.skippedCount++;
				} else {
					result.expandedCount++;
					if (expanded.telemetryData) telemetry.push(expanded.telemetryData);
				}
				hooks.onTaskDone?.(id, expanded);
			} catch (error) {
				result.failedCount++;
				hooks.onTaskDone?.(
					id,
					error instanceof Error ? error : new Error(String(error))
				);
			}
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
		const file =
			reportPath ??
			path.join(
				this.configManager.getProjectRoot(),
				tag === 'master'
					? COMPLEXITY_REPORT_FILE
					: COMPLEXITY_REPORT_FILE.replace('.json', `_${tag}.json`)
			);
		try {
			if (!fs.existsSync(file)) return undefined;
			const report = JSON.parse(fs.readFileSync(file, 'utf-8'));
			return (report?.complexityAnalysis as TaskAnalysis[] | undefined)?.find(
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
		num: ExpandOptions['num'],
		analysis: TaskAnalysis | undefined,
		aiConfig: AiConfig,
		warn: (message: string) => void
	): number | null {
		let count: number;
		const explicit = parseInt(String(num), 10);
		if (!Number.isNaN(explicit) && explicit >= 0) {
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
	private prepareSubtasks(task: Task, generated: any[]): Subtask[] {
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
			(message) => logger.debug(message)
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
