/**
 * @fileoverview The loop's progress file: the header a run appends when it
 * starts and the summary it appends when it ends
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { LoopConfig, LoopResult } from '../types.js';

export async function initProgressFile(config: LoopConfig): Promise<void> {
	await mkdir(path.dirname(config.progressFile), { recursive: true });
	const lines = [
		'# TaskGraph Loop Progress',
		`# Started: ${new Date().toISOString()}`,
		`# Preset: ${config.prompt}`,
		`# Max Iterations: ${config.iterations}`,
		...(config.tag ? [`# Tag: ${config.tag}`] : []),
		'',
		'---',
		''
	];
	// Append to existing progress file instead of overwriting
	await appendFile(
		config.progressFile,
		'\n' + lines.join('\n') + '\n',
		'utf-8'
	);
}

export async function appendFinalSummary(
	file: string,
	result: LoopResult
): Promise<void> {
	await appendFile(
		file,
		`
---
# Loop Complete: ${new Date().toISOString()}
- Total iterations: ${result.totalIterations}
- Tasks completed: ${result.tasksCompleted}
- Final status: ${result.finalStatus}
`,
		'utf-8'
	);
}
