/**
 * @fileoverview `loop --id`: run the loop on one named task instead of the
 * one `taskgraph next` picks. The checks run before Claude starts, so a typo
 * costs nothing.
 */

import { TASK_PRESETS, isPreset } from './presets/index.js';

/** A loop error the CLI prints as-is, with the fix underneath */
export class LoopError extends Error {
	constructor(
		message: string,
		readonly hint?: string
	) {
		super(message);
		this.name = 'LoopError';
	}
}

/** The task a pinned loop works on */
export interface LoopTask {
	id: string;
	title: string;
}

/** Whether a prompt is a built-in preset that works on TaskGraph tasks */
export function isTaskPreset(prompt: string): boolean {
	return isPreset(prompt) && TASK_PRESETS.includes(prompt);
}

/**
 * `--id` needs a preset that works on TaskGraph tasks (or a custom prompt
 * file, which may). `test-coverage`, `linting` and the like pick their own
 * work, so a task ID would be ignored.
 * @throws LoopError naming the preset
 */
export function assertTaskPreset(prompt: string): void {
	if (isPreset(prompt) && !isTaskPreset(prompt)) {
		throw new LoopError(
			`--id can't be combined with the ${prompt} preset: it doesn't work on tasks`,
			`Use --prompt ${TASK_PRESETS.join(' or --prompt ')}, or drop --id`
		);
	}
}

/**
 * How many iterations a run gets when the user didn't pass `-n`: one for a
 * pinned task (it is one task's work), otherwise the pending count for a
 * preset that works on tasks (`default`, `tdd`), otherwise 10.
 */
export function defaultIterations(options: {
	preset: string;
	taskId?: string;
	pendingTaskCount?: number;
}): number {
	if (options.taskId !== undefined) return 1;
	if (
		isTaskPreset(options.preset) &&
		options.pendingTaskCount !== undefined &&
		options.pendingTaskCount > 0
	) {
		return options.pendingTaskCount;
	}
	return 10;
}
