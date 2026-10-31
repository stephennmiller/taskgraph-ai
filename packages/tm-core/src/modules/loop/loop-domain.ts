/**
 * @fileoverview Loop Domain Facade
 * Public API for loop operations following the pattern of other domains
 */

import path from 'node:path';
import { getLogger } from '../../common/logger/index.js';
import { getHeadCommit } from '../../common/utils/git-utils.js';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TasksDomain } from '../tasks/tasks-domain.js';
import {
	PRESET_NAMES,
	isPreset as checkIsPreset,
	getPreset
} from './presets/index.js';
import {
	LoopError,
	type LoopTask,
	assertTaskPreset,
	defaultIterations,
	isTaskPreset
} from './loop-task.js';
import { isLoopTrusted, keepLoopTrust, trustLoop } from './loop-trust.js';
import { preflightContainer } from './parallel/container-workers.js';
import { ParallelLoopRunner } from './parallel/parallel-runner.js';
import { TaskWorktrees } from './parallel/task-worktrees.js';
import type {
	ParallelLoopOptions,
	ParallelLoopResult
} from './parallel/types.js';
import { LoopService } from './services/loop.service.js';
import { taskStatuses } from './task-progress.js';
import type { LoopConfig, LoopPreset, LoopResult } from './types.js';

/** A task ID (`3`) or a subtask ID (`3.2`): no spaces, at most one dot */
const TASK_ID_PATTERN = /^[^.\s]+(\.[^.\s]+)?$/;

/**
 * Loop Domain - Unified API for loop operations
 * Coordinates LoopService with lazy instantiation
 */
export class LoopDomain {
	private readonly logger = getLogger('LoopDomain');
	private loopService: LoopService | null = null;
	private readonly projectRoot: string;

	constructor(
		private readonly configManager: ConfigManager,
		private readonly tasks?: TasksDomain
	) {
		this.projectRoot = configManager.getProjectRoot();
	}

	// ========== Sandbox Auth Operations ==========

	/**
	 * Check if Docker sandbox auth is ready
	 * @returns Object with ready status and optional error message
	 */
	checkSandboxAuth(): { ready: boolean; error?: string } {
		const service = new LoopService({ projectRoot: this.projectRoot });
		return service.checkSandboxAuth();
	}

	/**
	 * Run Docker sandbox session for user authentication
	 * Blocks until user completes auth
	 * @returns Object with success status and optional error message
	 */
	runInteractiveAuth(): { success: boolean; error?: string } {
		const service = new LoopService({ projectRoot: this.projectRoot });
		return service.runInteractiveAuth();
	}

	// ========== Trust ==========

	/** Whether the user has approved unprompted runs in this project */
	isTrusted(): boolean {
		return isLoopTrusted(this.projectRoot);
	}

	/** Remember the user's approval for this project */
	trust(): void {
		trustLoop(this.projectRoot);
	}

	// ========== Loop Operations ==========

	/**
	 * Run a loop with the given configuration
	 * Creates a new LoopService instance and runs it
	 * @param config - Partial loop configuration (defaults will be applied)
	 * @returns Promise resolving to the loop result
	 * @throws Error if a loop is already running
	 */
	async run(config: Partial<LoopConfig>): Promise<LoopResult> {
		if (!config.sandbox && !config.trusted && !this.isTrusted()) {
			throw new Error(
				'loop runs Claude with permission prompts off in this project. Approve it first, or pass --trust (or use --sandbox).'
			);
		}

		// Prevent orphaning a previous running LoopService
		if (this.loopService?.isRunning) {
			try {
				this.loopService.stop();
			} catch (error) {
				// Log but don't block - stopping previous service is best-effort cleanup
				this.logger.warn('Failed to stop previous loop service:', error);
			}
		}

		const fullConfig = this.buildConfig(config);
		const tasks = this.tasks;
		this.loopService = new LoopService({
			projectRoot: this.projectRoot,
			findReadyTask: tasks
				? async (tag) => {
						const task = await tasks.getNext(tag);
						return task ? String(task.id) : undefined;
					}
				: undefined,
			taskStatuses: tasks
				? async (tag) => taskStatuses((await tasks.list({ tag })).tasks)
				: undefined,
			headCommit: () => getHeadCommit(this.projectRoot)
		});
		return this.loopService.run(fullConfig);
	}

	/**
	 * Check a `--id` before the loop starts: the preset must work on tasks
	 * and the task or subtask must exist.
	 * @returns The task's ID and title, for the CLI to show
	 * @throws LoopError (with a hint) for a preset that ignores tasks or an
	 *   ID that isn't in the tag
	 */
	async resolveTask(
		taskId: string,
		options: { prompt?: string; tag?: string } = {}
	): Promise<LoopTask> {
		assertTaskPreset(options.prompt ?? 'default');
		const id = taskId.trim();
		// One task ID, or one dot for a subtask: the ID goes into Claude's
		// prompt, so `3.2.9` or `3 and also 4` must not reach it
		const found =
			TASK_ID_PATTERN.test(id) && this.tasks
				? await this.tasks.get(id, options.tag)
				: null;
		// tasks.get falls back to the parent when it has no subtasks list
		if (!found?.task || (id.includes('.') && !found.isSubtask)) {
			throw new LoopError(
				`Task "${id}" doesn't exist${options.tag ? ` in tag '${options.tag}'` : ''}`,
				'Run `taskgraph list` to see task IDs'
			);
		}
		return { id, title: found.task.title };
	}

	/**
	 * Run up to `parallel` ready tasks (wave 1) side by side, each claimed,
	 * in its own worktree on `taskgraph/task-<id>`, with one Claude Code
	 * process per task. Never merges. Abort with `options.signal`.
	 * @throws ParallelLoopError (with a hint) for a bad count, a dirty tree,
	 *   or a project that isn't a git repository
	 */
	async runParallel(options: ParallelLoopOptions): Promise<ParallelLoopResult> {
		if (!options.trusted && !this.isTrusted()) {
			throw new Error(
				'loop runs Claude with permission prompts off in this project. Approve it first, or pass --trust.'
			);
		}
		if (!this.tasks) {
			throw new Error('loop --parallel needs the tasks domain');
		}
		const approved = isLoopTrusted(this.projectRoot);
		try {
			return await new ParallelLoopRunner(this.projectRoot, this.tasks, () =>
				this.configManager.getActiveTag()
			).run(options);
		} finally {
			// The tasks' own changes (notes, new subtasks) stay approved for the next run
			if (approved) keepLoopTrust(this.projectRoot);
		}
	}

	/**
	 * What `--container` needs (token, a running Docker, a git identity),
	 * checked without claiming anything, so the CLI can stop before it asks
	 * for approval.
	 * @throws ParallelLoopError for the first thing missing
	 */
	async checkContainer(options: {
		image?: string;
		runtime?: string;
	}): Promise<void> {
		await preflightContainer(
			this.projectRoot,
			new TaskWorktrees(this.projectRoot),
			options
		);
	}

	/**
	 * Stop the currently running loop
	 * Signals the loop to stop and nulls the service reference
	 */
	stop(): void {
		if (this.loopService) {
			this.loopService.stop();
			this.loopService = null;
		}
	}

	/**
	 * Check if a loop is currently running
	 */
	getIsRunning(): boolean {
		return this.loopService?.isRunning ?? false;
	}

	// ========== Preset Operations ==========

	/**
	 * Type guard to check if a string is a valid preset name
	 * @param prompt - The string to check
	 * @returns True if the prompt is a valid LoopPreset
	 */
	isPreset(prompt: string): prompt is LoopPreset {
		return checkIsPreset(prompt);
	}

	/**
	 * Resolve a prompt string to its content
	 * For preset names, returns the inlined content
	 * For file paths, reads the file (requires readFile callback)
	 * @param prompt - Either a preset name or a file path
	 * @param readFile - Optional async function to read file content
	 * @returns Promise resolving to the prompt content string
	 */
	async resolvePrompt(
		prompt: LoopPreset | string,
		readFile?: (path: string) => Promise<string>
	): Promise<string> {
		if (checkIsPreset(prompt)) {
			return getPreset(prompt);
		}
		if (!readFile) {
			throw new Error(
				`Custom prompt file requires readFile callback: ${prompt}`
			);
		}
		return readFile(prompt);
	}

	/**
	 * Whether a prompt is a built-in preset that works on TaskGraph tasks
	 * (`default`, `tdd`), so the run starts on `taskgraph next`'s pick
	 */
	isTaskPreset(prompt: string): boolean {
		return isTaskPreset(prompt);
	}

	/**
	 * Get all available preset names
	 * @returns Array of available preset names
	 */
	getAvailablePresets(): LoopPreset[] {
		return [...PRESET_NAMES];
	}

	// ========== Iteration Resolution ==========

	/**
	 * Resolve the number of iterations to use:
	 * - the user's `-n`, when given
	 * - 1 for a pinned task (`--id`)
	 * - the pending count (tasks + subtasks) for the default preset
	 * - otherwise 10
	 */
	resolveIterations(options: {
		userIterations?: number;
		preset: string;
		taskId?: string;
		pendingTaskCount?: number;
	}): number {
		if (options.userIterations !== undefined) {
			return options.userIterations;
		}
		return defaultIterations(options);
	}

	// ========== Internal Helpers ==========

	/**
	 * Build a complete LoopConfig from partial input
	 * Applies sensible defaults for any missing fields
	 * @param partial - Partial configuration to merge with defaults
	 * @returns Complete LoopConfig with all required fields
	 */
	private buildConfig(partial: Partial<LoopConfig>): LoopConfig {
		return {
			iterations: partial.iterations ?? 10,
			prompt: partial.prompt ?? 'default',
			// Relative to the project root, where Claude runs and reads it from
			progressFile: path.resolve(
				this.projectRoot,
				partial.progressFile ?? '.taskgraph/progress.txt'
			),
			sleepSeconds: partial.sleepSeconds ?? 5,
			tag: partial.tag,
			taskId: partial.taskId,
			sandbox: partial.sandbox ?? false,
			verbose: partial.verbose ?? false,
			maxTurns: partial.maxTurns,
			maxBudgetUsd: partial.maxBudgetUsd,
			callbacks: partial.callbacks
		};
	}
}
