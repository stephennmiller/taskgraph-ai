/**
 * @fileoverview The prompt each loop iteration sends Claude: a header naming
 * the progress file, iteration and task, then the preset or custom prompt
 */

import { readFile } from 'node:fs/promises';
import {
	TASK_DATA_RULE,
	TASK_DATA_TAG,
	neutralizeTag
} from '../../../common/utils/prompt-tag.js';
import { PRESETS, isPreset } from '../presets/index.js';
import type { LoopConfig } from '../types.js';

/** Appended to every prompt, presets and custom files alike */
const SIGNAL_RULE =
	'To stop the loop, end your reply with the <loop-complete> or <loop-blocked> marker alone on the last line. A marker anywhere else is ignored.';

async function resolvePrompt(prompt: string): Promise<string> {
	if (isPreset(prompt)) {
		return PRESETS[prompt];
	}
	const content = await readFile(prompt, 'utf-8');
	if (!content.trim()) {
		throw new Error(`Custom prompt file '${prompt}' is empty`);
	}
	return content;
}

/** An in-progress task an earlier run stopped on, and the files it left uncommitted */
export interface InterruptedTask {
	taskId: string;
	files: string[];
}

/** The most file names the header lists */
const MAX_LISTED_FILES = 20;

/** Tells the session where the interrupted task's work is, so it doesn't start over */
function interruptedLine({ taskId, files }: InterruptedTask): string {
	// Quoted, so a file name can't add a line or a comma to the list
	const listed = files.slice(0, MAX_LISTED_FILES).map((f) => JSON.stringify(f));
	const more =
		files.length > MAX_LISTED_FILES
			? ` and ${files.length - MAX_LISTED_FILES} more`
			: '';
	const line = `Task ${taskId} was interrupted. These files have its uncommitted changes: ${listed.join(', ')}${more}. Check them and continue from them rather than starting over.`;
	return neutralizeTag(line, TASK_DATA_TAG);
}

export function buildContextHeader(
	config: Pick<LoopConfig, 'iterations' | 'progressFile' | 'tag' | 'taskId'>,
	iteration: number,
	interrupted?: InterruptedTask
): string {
	const tagInfo = config.tag ? ` (tag: ${config.tag})` : '';
	// The pinned task replaces the preset's `taskgraph next` step
	const taskInfo = config.taskId
		? `\n\nWork on task ${config.taskId} only. Use it in place of the task taskgraph next would pick, and read it with taskgraph show ${config.taskId}. Stop once it is done.`
		: '';
	const interruptedInfo = interrupted
		? `\n\n${interruptedLine(interrupted)}`
		: '';
	// No @CLAUDE.md: Claude Code loads it as project memory already
	return `@${config.progressFile}

Loop iteration ${iteration} of ${config.iterations}${tagInfo}${taskInfo}${interruptedInfo}`;
}

/** Opens a resumed iteration's prompt: the history above it is the last task's */
const RESUMED_NOTE =
	'A new loop iteration starts here. The conversation above was the previous iteration; treat its task as finished or handed over, and follow the steps below from the start.';

export async function buildPrompt(
	config: LoopConfig,
	iteration: number,
	resumed = false,
	interrupted?: InterruptedTask
): Promise<string> {
	const basePrompt = await resolvePrompt(config.prompt);
	const header = buildContextHeader(config, iteration, interrupted);
	return `${resumed ? `${RESUMED_NOTE}\n\n` : ''}${header}\n\n${basePrompt}\n\n${TASK_DATA_RULE}\n\n${SIGNAL_RULE}`;
}
