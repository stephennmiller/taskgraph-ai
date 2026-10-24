/**
 * @fileoverview AI commands of the tasks domain: add, expand, scope,
 * research, update, parse-prd and analyze-complexity. TasksDomain exposes
 * each one as `tmCore.tasks.<name>`; add a new AI command here.
 */

import {
	AiService,
	type AiServiceParams,
	type AiServiceResult
} from '../ai/ai-service.js';
import { AiConfig } from '../ai/config-ai-host.js';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TaskService } from './services/task-service.js';

import {
	AnalyzeComplexityService,
	type AnalyzeComplexityHooks,
	type AnalyzeComplexityInput,
	type AnalyzeComplexityResult,
	type ComplexityReportFile,
	readComplexityReport
} from './services/analyze-complexity.service.js';
import {
	AddTaskService,
	type AddTaskHooks,
	type AddTaskInput,
	type AddTaskResult
} from './services/add-task.service.js';
import {
	ExpandTaskService,
	type ExpandAllHooks,
	type ExpandAllResult,
	type ExpandOptions,
	type ExpandTaskHooks,
	type ExpandTaskInput,
	type ExpandTaskResult
} from './services/expand-task.service.js';
import {
	ParsePrdService,
	type ParsePrdHooks,
	type ParsePrdInput,
	type ParsePrdResult,
	type PrdGapsResult
} from './services/parse-prd.service.js';
import {
	ScopeAdjustmentService,
	type ScopeTaskHooks,
	type ScopeTaskInput,
	type ScopeTaskResult
} from './services/scope-adjustment.service.js';
import {
	ResearchService,
	type ResearchExchange,
	type ResearchHooks,
	type ResearchInput,
	type ResearchResult,
	type ResearchSaved
} from './services/research.service.js';
import {
	type UpdateSubtaskHooks,
	type UpdateSubtaskInput,
	type UpdateSubtaskResult,
	UpdateSubtaskService
} from './services/update-subtask.service.js';
import {
	UpdateTaskService,
	type UpdateFromInput,
	type UpdateFromResult,
	type UpdateHooks,
	type UpdateTaskInput,
	type UpdateTaskResult
} from './services/update-task.service.js';

/** The AI commands behind TasksDomain, built per call as before */
export class TaskAiCommands {
	constructor(
		private taskService: TaskService,
		private configManager: ConfigManager
	) {}

	/**
	 * Score the tag's active tasks (pending, blocked, in-progress), or those
	 * named by `ids` or the `from`-`to` range, and save them to the tag's
	 * complexity report. Entries for the tag's other tasks stay in the report.
	 */
	async analyzeComplexity(
		input: AnalyzeComplexityInput = {},
		hooks?: AnalyzeComplexityHooks
	): Promise<AnalyzeComplexityResult> {
		return new AnalyzeComplexityService(this.configManager).analyze(
			input,
			hooks
		);
	}

	/**
	 * The tag's complexity report, or `file` (relative to the project root).
	 * Null when there is none.
	 */
	getComplexityReport(
		options: { tag?: string; file?: string } = {}
	): { report: ComplexityReportFile; reportPath: string } | null {
		return readComplexityReport(this.configManager.getProjectRoot(), {
			tag: options.tag || this.configManager.getActiveTag(),
			file: options.file
		});
	}

	/**
	 * Add one task: written by the AI from `prompt`, or given as `title` and
	 * `description` (no AI call). The AI call runs without the file lock; the
	 * save re-reads tasks.json under it and appends only the new task, with
	 * an ID free at that moment. Dependencies that don't exist in the tag are
	 * dropped with a warning; an unknown `discoveredFrom` throws before any AI call.
	 */
	async add(input: AddTaskInput, hooks?: AddTaskHooks): Promise<AddTaskResult> {
		return new AddTaskService(
			() => this.taskService.getStorage(),
			this.configManager
		).add(input, hooks);
	}

	/**
	 * Expand a top-level task into subtasks with the AI. The count and prompt
	 * come from `num`, else the complexity report, else defaultSubtasks; a
	 * report count of 0 skips the task without an AI call. New subtasks are
	 * added, or with `force` replace the old ones. The AI call runs without
	 * the file lock; the save changes only this task's subtasks.
	 */
	async expand(
		input: ExpandTaskInput,
		hooks?: ExpandTaskHooks
	): Promise<ExpandTaskResult> {
		return new ExpandTaskService(this.taskService, this.configManager).expand(
			input,
			hooks
		);
	}

	/**
	 * Make tasks more (`direction: 'up'`) or less complex with the AI, then
	 * rewrite their pending subtasks to match; subtasks with work on them
	 * stay. Strength and every ID are checked before any AI call; each task
	 * is saved on its own, changing only that task.
	 */
	async scope(
		input: ScopeTaskInput,
		hooks?: ScopeTaskHooks
	): Promise<ScopeTaskResult> {
		return new ScopeAdjustmentService(
			this.taskService,
			this.configManager
		).scope(input, hooks);
	}

	/**
	 * Ask the research model a question with project context: the tasks you
	 * name plus the ones matching the question, files inside the project
	 * (never secrets), the project tree and your notes. Task IDs and files
	 * are checked before the AI call. saveTo appends the answer to a task's
	 * details in one locked write; a save that fails is reported in
	 * `saveFailures`, and the answer is kept.
	 */
	async research(
		input: ResearchInput,
		hooks?: ResearchHooks
	): Promise<ResearchResult> {
		return new ResearchService(this.taskService, this.configManager).research(
			input,
			hooks
		);
	}

	/**
	 * Have the AI write notes for a subtask ("5.2") from a prompt, appended
	 * to its details as a timestamped block; `metadata` alone skips the AI.
	 * The AI call runs without the file lock; the save changes only that
	 * subtask, and an empty answer saves no notes.
	 */
	async updateSubtask(
		input: UpdateSubtaskInput,
		hooks?: UpdateSubtaskHooks
	): Promise<UpdateSubtaskResult> {
		return new UpdateSubtaskService(
			this.taskService,
			this.configManager
		).updateSubtask(input, hooks);
	}

	/**
	 * Expand every pending or in-progress task that has no subtasks (any,
	 * with `force`), three at a time. Failures are counted, not thrown.
	 */
	async expandAll(
		options: ExpandOptions,
		hooks?: ExpandAllHooks
	): Promise<ExpandAllResult> {
		return new ExpandTaskService(
			this.taskService,
			this.configManager
		).expandAll(options, hooks);
	}

	/**
	 * Save a research conversation to a task's details (one locked write) or
	 * to .taskgraph/docs/research/
	 */
	async saveResearch(
		history: ResearchExchange[],
		target: { taskId: string } | { file: true },
		tag?: string
	): Promise<ResearchSaved> {
		return new ResearchService(
			this.taskService,
			this.configManager
		).saveResearch(history, target, tag);
	}

	/**
	 * Rewrite a top-level task with the AI from `prompt`, or with `append`
	 * add the AI's text to its details; `metadata` alone saves without a
	 * call. A done task is skipped. The AI call runs without the file lock;
	 * the save applies only what the rewrite changed.
	 */
	async updateWithPrompt(
		input: UpdateTaskInput,
		hooks?: UpdateHooks
	): Promise<UpdateTaskResult> {
		return new UpdateTaskService(
			this.taskService,
			this.configManager
		).updateTask(input, hooks);
	}

	/** Rewrite every unfinished task from `from` on with the AI, in one call */
	async updateFrom(
		input: UpdateFromInput,
		hooks?: UpdateHooks
	): Promise<UpdateFromResult> {
		return new UpdateTaskService(
			this.taskService,
			this.configManager
		).updateFrom(input, hooks);
	}

	/**
	 * Generate the tag's tasks from a PRD with the AI. Refuses a tag that has
	 * tasks unless `force` (replace them) or `append` (add to them; for a PRD
	 * parsed before, only its new sections). The AI call runs without the
	 * file lock; the save re-reads the tag.
	 */
	async parsePrd(
		input: ParsePrdInput,
		hooks?: ParsePrdHooks
	): Promise<ParsePrdResult> {
		return new ParsePrdService(this.taskService, this.configManager).parse(
			input,
			hooks
		);
	}

	/**
	 * The PRD a parsePrd with these options would read (the default one in
	 * .taskgraph/docs when none is named), its tag, and the tag's task count
	 */
	async parsePrdTarget(input: Pick<ParsePrdInput, 'prdPath' | 'tag'>) {
		return new ParsePrdService(this.taskService, this.configManager).target(
			input
		);
	}

	/**
	 * One structured AI call with the project's models and settings, for a
	 * caller that isn't a task command (the plan evals' judge)
	 */
	async generateObject(
		params: AiServiceParams,
		hooks?: { onWarning?: (message: string) => void }
	): Promise<AiServiceResult> {
		const aiConfig = new AiConfig(this.configManager, (level, message) => {
			if (level === 'warn') hooks?.onWarning?.(message);
		});
		return new AiService(aiConfig.toHost()).generateObject(params);
	}

	/** The questions worth asking about gaps in a PRD before parsing it */
	async findPrdGaps(
		input: Pick<
			ParsePrdInput,
			'prdPath' | 'research' | 'session' | 'outputType'
		>
	): Promise<PrdGapsResult> {
		return new ParsePrdService(this.taskService, this.configManager).findGaps(
			input
		);
	}
}
