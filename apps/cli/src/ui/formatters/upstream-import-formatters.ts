/**
 * @fileoverview What `taskgraph init` moved when it imports the upstream
 * project's folder (UPSTREAM_DIR from @tm/core), e.g.
 *
 *   ✓ Imported 4 tasks in 2 tags, docs, reports and templates from <dir>/
 *     .gitignore    created
 *   Skipped the research model (perplexity sonar-pro) and 6 provider settings
 *   Left out <name>'s default of 10 tasks; parse-prd sizes the list to the PRD
 *   <dir>/ is unchanged · Next: taskgraph next
 *
 * It replaces init's usual summary and its "write a PRD" steps, which don't
 * apply to a project that already has tasks.
 */

import {
	DROPPED_NUM_TASKS_SETTING,
	UPSTREAM_DIR,
	UPSTREAM_NAME,
	type UpstreamImportResult
} from '@tm/core';
import chalk from 'chalk';
import { theme } from '../theme.js';
import type { InitChange } from './init-summary-formatters.js';

export interface UpstreamImportSummary {
	result: Pick<
		UpstreamImportResult,
		'tags' | 'taskCount' | 'copiedFiles' | 'droppedModels' | 'droppedSettings'
	>;
	/** Other files init created or changed (not .taskgraph/ itself) */
	changes: InitChange[];
}

const plural = (count: number, word: string) =>
	`${count} ${count === 1 ? word : `${word}s`}`;

/** "a", "a and b", "a, b and c" */
function joinList(items: string[]): string {
	if (items.length <= 1) return items.join('');
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function whatMoved(result: UpstreamImportSummary['result']): string[] {
	const moved: string[] = [];
	if (result.tags.length > 0) {
		const tasks = plural(result.taskCount, 'task');
		moved.push(
			result.tags.length > 1 ? `${tasks} in ${result.tags.length} tags` : tasks
		);
	}
	for (const [folder, count] of Object.entries(result.copiedFiles)) {
		if (count > 0) moved.push(folder);
	}
	return moved;
}

function whatWasSkipped(result: UpstreamImportSummary['result']): string {
	const models = result.droppedModels;
	const skipped: string[] = [];
	// One model names what it was; several just name the roles, to fit a line
	if (models.length === 1) {
		const [model] = models;
		skipped.push(
			`the ${model.role} model (${model.provider} ${model.modelId})`
		);
	} else if (models.length > 1) {
		skipped.push(`the ${joinList(models.map((m) => m.role))} models`);
	}
	const settings = result.droppedSettings.filter(
		(key) => key !== DROPPED_NUM_TASKS_SETTING
	);
	if (settings.length > 0) {
		skipped.push(plural(settings.length, 'provider setting'));
	}
	return skipped.length > 0 ? `Skipped ${joinList(skipped)}` : '';
}

/**
 * Format the summary printed at the end of an importing `taskgraph init`.
 */
export function formatUpstreamImport(summary: UpstreamImportSummary): string {
	const { result, changes } = summary;
	const moved = whatMoved(result);
	const lines = [
		moved.length > 0
			? `${chalk.green('✓')} Imported ${joinList(moved)} from ${UPSTREAM_DIR}/`
			: `${chalk.green('✓')} Set up TaskGraph; ${UPSTREAM_DIR}/ had nothing to import`
	];

	const width = Math.max(0, ...changes.map((change) => change.path.length));
	for (const change of changes) {
		lines.push(`  ${change.path.padEnd(width)}  ${theme.muted(change.note)}`);
	}

	const skipped = whatWasSkipped(result);
	if (skipped) lines.push(theme.muted(skipped));
	if (result.droppedSettings.includes(DROPPED_NUM_TASKS_SETTING)) {
		lines.push(
			theme.muted(
				`Left out ${UPSTREAM_NAME}'s default of 10 tasks; parse-prd sizes the list to the PRD`
			)
		);
	}

	const next = result.taskCount > 0 ? 'taskgraph next' : 'taskgraph parse-prd';
	lines.push(
		`${theme.muted(`${UPSTREAM_DIR}/ is unchanged ·`)} Next: ${theme.brand(next)}`
	);
	return lines.join('\n');
}
