/**
 * @fileoverview The loop's progress file: the header a run appends when it
 * starts, the line it appends after each iteration, and the summary it
 * appends when it ends
 */

import { appendProjectFile } from '../../storage/adapters/file-storage/file-operations.js';
import type { LoopConfig, LoopIteration, LoopResult } from '../types.js';

export async function initProgressFile(
	projectRoot: string,
	config: LoopConfig
): Promise<void> {
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
	await appendProjectFile(
		projectRoot,
		config.progressFile,
		'\n' + lines.join('\n') + '\n'
	);
}

/** `$0.42 · 12 turns`, leaving out what Claude Code didn't report; `partial`: a total missing an unknown cost */
function spend(
	costUsd?: number,
	turns?: number,
	costUnknown?: boolean,
	partial?: boolean
): string[] {
	const cost =
		costUsd === undefined
			? costUnknown || partial
				? 'cost unknown'
				: undefined
			: `${costUnknown ? 'cost unknown, counted as ' : partial ? 'at least ' : ''}$${costUsd.toFixed(2)}`;
	return [
		...(cost ? [cost] : []),
		...(turns !== undefined ? [`${turns} turns`] : [])
	];
}

/** `# Iteration 2: success · resumed · complexity 2 · sonnet, low effort · $0.42 · 12 turns · 83s` */
export async function appendIterationLine(
	projectRoot: string,
	file: string,
	iteration: LoopIteration
): Promise<void> {
	const setting = [
		iteration.model,
		iteration.effort && `${iteration.effort} effort`
	].filter(Boolean);
	const facts = [
		iteration.status,
		...(iteration.status === 'error' && iteration.message
			? [iteration.message]
			: []),
		...(iteration.session ? [iteration.session] : []),
		...(iteration.complexity !== undefined
			? [`complexity ${iteration.complexity}`]
			: []),
		...(setting.length ? [setting.join(', ')] : []),
		...spend(iteration.costUsd, iteration.turns, iteration.costUnknown),
		...(iteration.duration !== undefined
			? [`${Math.round(iteration.duration / 1000)}s`]
			: [])
	];
	await appendProjectFile(
		projectRoot,
		file,
		`# Iteration ${iteration.iteration}: ${facts.join(' · ')}\n`
	);
}

export async function appendFinalSummary(
	projectRoot: string,
	file: string,
	result: LoopResult
): Promise<void> {
	const cost = spend(
		result.totalCostUsd,
		result.totalTurns,
		false,
		result.costPartial
	);
	await appendProjectFile(
		projectRoot,
		file,
		`
---
# Loop Complete: ${new Date().toISOString()}
- Total iterations: ${result.totalIterations}
- Tasks completed: ${result.tasksCompleted}
- Final status: ${result.finalStatus}
${cost.length ? `- Spent: ${cost.join(' · ')}\n` : ''}${result.totalDurationMs !== undefined ? `- Time: ${Math.round(result.totalDurationMs / 60000)} min\n` : ''}${(result.setAside ?? []).map((t) => `- Set aside task ${t.id} (${t.reason}): run taskgraph show ${t.id}, then taskgraph set-status --id=${t.id} --status=pending\n`).join('')}`
	);
}
