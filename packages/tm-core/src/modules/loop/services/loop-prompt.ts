/**
 * @fileoverview The prompt each loop iteration sends Claude: a header naming
 * the progress file, iteration and task, then the preset or custom prompt
 */

import { readFile } from 'node:fs/promises';
import { TASK_DATA_RULE } from '../../../common/utils/prompt-tag.js';
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

export function buildContextHeader(
	config: Pick<LoopConfig, 'iterations' | 'progressFile' | 'tag' | 'taskId'>,
	iteration: number
): string {
	const tagInfo = config.tag ? ` (tag: ${config.tag})` : '';
	// The pinned task replaces the preset's `taskgraph next` step
	const taskInfo = config.taskId
		? `\n\nWork on task ${config.taskId} only. Use it in place of the task taskgraph next would pick, and read it with taskgraph show ${config.taskId}.`
		: '';
	return `@${config.progressFile} @CLAUDE.md

Loop iteration ${iteration} of ${config.iterations}${tagInfo}${taskInfo}`;
}

export async function buildPrompt(
	config: LoopConfig,
	iteration: number
): Promise<string> {
	const basePrompt = await resolvePrompt(config.prompt);
	return `${buildContextHeader(config, iteration)}\n\n${basePrompt}\n\n${TASK_DATA_RULE}\n\n${SIGNAL_RULE}`;
}
