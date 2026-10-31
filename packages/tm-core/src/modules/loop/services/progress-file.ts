/**
 * @fileoverview The loop's progress file: the header a run appends when it
 * starts, the line it appends after each iteration, and the summary it
 * appends when it ends
 */

import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { LoopConfig, LoopIteration, LoopResult } from '../types.js';

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

/** `$0.42 · 12 turns`, leaving out what Claude Code didn't report */
function spend(costUsd?: number, turns?: number): string[] {
	return [
		...(costUsd !== undefined ? [`$${costUsd.toFixed(2)}`] : []),
		...(turns !== undefined ? [`${turns} turns`] : [])
	];
}

/** `# Iteration 2: success · resumed · complexity 2 · sonnet, low effort · $0.42 · 12 turns · 83s` */
export async function appendIterationLine(
	file: string,
	iteration: LoopIteration
): Promise<void> {
	const setting = [
		iteration.model,
		iteration.effort && `${iteration.effort} effort`
	].filter(Boolean);
	const facts = [
		iteration.status,
		...(iteration.session ? [iteration.session] : []),
		...(iteration.complexity !== undefined
			? [`complexity ${iteration.complexity}`]
			: []),
		...(setting.length ? [setting.join(', ')] : []),
		...spend(iteration.costUsd, iteration.turns),
		...(iteration.duration !== undefined
			? [`${Math.round(iteration.duration / 1000)}s`]
			: [])
	];
	await appendFile(
		file,
		`# Iteration ${iteration.iteration}: ${facts.join(' · ')}\n`,
		'utf-8'
	);
}

export async function appendFinalSummary(
	file: string,
	result: LoopResult
): Promise<void> {
	const cost = spend(result.totalCostUsd, result.totalTurns);
	await appendFile(
		file,
		`
---
# Loop Complete: ${new Date().toISOString()}
- Total iterations: ${result.totalIterations}
- Tasks completed: ${result.tasksCompleted}
- Final status: ${result.finalStatus}
${cost.length ? `- Spent: ${cost.join(' · ')}\n` : ''}`,
		'utf-8'
	);
}
