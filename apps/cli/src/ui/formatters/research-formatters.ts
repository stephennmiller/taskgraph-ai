/**
 * @fileoverview What `research` tells you around the answer, e.g.
 *
 *   Context: task 3 · related 1, 2, 4 · README.md · project tree
 *   ⠋ Researching… 12s
 *   <the answer, rendered once>
 *   ✓ Saved to task 3
 *
 * They replace a boxed "AI Research Query" banner, a boxed per-task token
 * table, and the answer printed twice (streamed raw, then again in a box).
 */

import chalk from 'chalk';
import { theme } from '../theme.js';
import { formatMarkdown } from './markdown-formatters.js';

/** Answers wrap at the terminal width, but no wider than this */
const MAX_ANSWER_WIDTH = 100;

/**
 * Render a research answer's markdown for the terminal, wrapped to the
 * terminal width (at most 100 columns). Any <think>…</think> reasoning is
 * dropped.
 */
export function formatResearchAnswer(
	markdown: string,
	width = process.stdout.columns || 80
): string {
	const columns = Math.max(40, Math.min(width, MAX_ANSWER_WIDTH));
	const answer = markdown.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
	return formatMarkdown(answer, columns);
}

export interface ResearchContextSummary {
	/** Task IDs you passed with --id */
	taskIds: string[];
	/** Task IDs found by searching for the question */
	relatedTaskIds: string[];
	/** File paths you passed with --files */
	files: string[];
	/** --tree */
	projectTree?: boolean;
	/** --context */
	customContext?: boolean;
}

/** Where `research` saved the answer */
export type ResearchSaveTarget =
	| { kind: 'task'; id: string }
	| { kind: 'file'; path: string };

/** Sorts `10, 2, 3.2` as `2, 3.2, 10` */
export function sortTaskIds(ids: string[]): string[] {
	const parts = (id: string) =>
		id.split('.').map((n) => Number.parseInt(n, 10));
	return [...ids].sort((a, b) => {
		const [pa, pb] = [parts(a), parts(b)];
		for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
			const diff = (pa[i] ?? -1) - (pb[i] ?? -1);
			if (diff !== 0) return diff;
		}
		return 0;
	});
}

const taskLabel = (ids: string[]) =>
	`${ids.length === 1 ? 'task' : 'tasks'} ${sortTaskIds(ids).join(', ')}`;

/**
 * One muted line saying what the question will be asked with, or '' when
 * there is no project context.
 */
export function formatResearchContext(summary: ResearchContextSummary): string {
	const parts: string[] = [];
	const { taskIds, relatedTaskIds, files } = summary;

	if (taskIds.length > 0) parts.push(taskLabel(taskIds));
	if (relatedTaskIds.length > 0) {
		parts.push(
			taskIds.length > 0
				? `related ${sortTaskIds(relatedTaskIds).join(', ')}`
				: `related ${taskLabel(relatedTaskIds)}`
		);
	}
	if (files.length > 0) {
		parts.push(files.length <= 2 ? files.join(', ') : `${files.length} files`);
	}
	if (summary.projectTree) parts.push('project tree');
	if (summary.customContext) parts.push('your notes');

	if (parts.length === 0) return '';
	return theme.muted(`Context: ${parts.join(' · ')}`);
}

/** `✓ Saved to task 3` or `✓ Saved to .taskgraph/docs/research/….md` */
export function formatResearchSaved(target: ResearchSaveTarget): string {
	const where =
		target.kind === 'file'
			? target.path
			: `${target.id.includes('.') ? 'subtask' : 'task'} ${target.id}`;
	return `${chalk.green('✓')} Saved to ${where}`;
}

/** `✗ Couldn't save to task 9: Task 9 doesn't exist` */
export function formatResearchSaveFailed(
	target: ResearchSaveTarget,
	reason: string
): string {
	const where =
		target.kind === 'file'
			? 'a file'
			: `${target.id.includes('.') ? 'subtask' : 'task'} ${target.id}`;
	return `${chalk.red('✗')} Couldn't save to ${where}: ${reason}`;
}
