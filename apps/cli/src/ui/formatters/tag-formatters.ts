/**
 * @fileoverview What the `tags` commands did, e.g.
 *
 *   ✓ Created tag feature-auth · 4 tasks from master
 *     Auth work
 *   Switch to it with taskgraph tags use feature-auth
 *
 *   ✓ Switched to feature-auth · 4 tasks
 *   Next: 1  Set up the Express API server
 *
 *   ✓ Renamed feature-auth to feature-login · current tag
 *   ✓ Copied master to backup · 4 tasks
 *   ✓ Deleted tag backup and its 4 tasks
 *
 * and the `tags` list:
 *
 *     Tag           Tasks  Ready  Done
 *   ● feature-auth      0      0     0
 *     master            4      2     0
 *
 * and the line a command opens with when the tag matters (see
 * shouldShowTagIndicator in @tm/core):
 *
 *   [tag] feature-auth
 *
 * They replace a boxed "✓ Tag … Successfully" panel per command and a
 * bordered table about 116 columns wide.
 */

import { sanitizeForTerminal } from '@tm/core';
import chalk from 'chalk';
import { terminalWidth } from '../layout/helpers.js';
import { theme } from '../theme.js';

type Id = number | string;

/** The muted line naming the tag a command works in */
export function formatTagIndicator(tag: string): string {
	tag = sanitizeForTerminal(tag);
	return theme.muted(`[tag] ${tag}`);
}

/** One row of the `tags` list */
export interface TagSummary {
	name: string;
	isCurrent: boolean;
	taskCount: number;
	readyTasks: number;
	completedTasks: number;
	/** ISO date, or 'Unknown' */
	created?: string;
	description?: string;
}

const plural = (count: number, noun: string) =>
	`${count} ${count === 1 ? noun : `${noun}s`}`;

const fit = (text: string, width: number) =>
	text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text;

const ok = (text: string) => `${chalk.green('✓')} ${text}`;

/** Muted ` · a · b` suffix, or nothing */
const facts = (...parts: Array<string | false | null | undefined>) => {
	const present = parts.filter(Boolean) as string[];
	return present.length ? theme.muted(` · ${present.join(' · ')}`) : '';
};

const switchHint = (tagName: string) =>
	theme.muted('Switch to it with ') +
	theme.brand(`taskgraph tags use ${tagName}`);

/**
 * @param result.description - Only a description the user gave, not the
 *   "Tag created on …" default
 */
export function formatTagCreated(
	result: {
		tagName: string;
		tasksCopied: number;
		sourceTag?: string | null;
		description?: string;
	},
	width = terminalWidth()
): string {
	result = sanitizeForTerminal(result);
	const copied =
		result.sourceTag &&
		`${plural(result.tasksCopied, 'task')} from ${result.sourceTag}`;
	const lines = [ok(`Created tag ${result.tagName}`) + facts(copied)];
	if (result.description) {
		lines.push(`  ${theme.muted(fit(result.description, width - 2))}`);
	}
	lines.push(switchHint(result.tagName));
	return lines.join('\n');
}

export function formatTagSwitched(
	result: {
		previousTag?: string | null;
		currentTag: string;
		taskCount: number;
		nextTask?: { id: Id; title: string } | null;
	},
	width = terminalWidth()
): string {
	result = sanitizeForTerminal(result);
	const count = plural(result.taskCount, 'task');
	const lines = [
		result.previousTag === result.currentTag
			? `Already on ${result.currentTag}${facts(count)}`
			: ok(`Switched to ${result.currentTag}`) + facts(count)
	];

	if (result.nextTask) {
		const id = String(result.nextTask.id);
		// "Next: " is 6 columns, then the ID and two spaces
		const title = fit(result.nextTask.title, width - 8 - id.length);
		lines.push(`${theme.muted('Next:')} ${theme.brand(id)}  ${title}`);
	} else if (result.taskCount === 0) {
		lines.push(
			theme.muted('Add tasks with ') +
				theme.brand('taskgraph add-task') +
				theme.muted(' or ') +
				theme.brand('taskgraph parse-prd <file>')
		);
	} else {
		lines.push(theme.muted('No task is ready to start'));
	}
	return lines.join('\n');
}

export function formatTagRenamed(result: {
	oldName: string;
	newName: string;
	isCurrentTag?: boolean;
}): string {
	result = sanitizeForTerminal(result);
	return (
		ok(`Renamed ${result.oldName} to ${result.newName}`) +
		facts(result.isCurrentTag && 'current tag')
	);
}

export function formatTagCopied(result: {
	sourceName: string;
	targetName: string;
	tasksCopied: number;
}): string {
	result = sanitizeForTerminal(result);
	return [
		ok(`Copied ${result.sourceName} to ${result.targetName}`) +
			facts(plural(result.tasksCopied, 'task')),
		switchHint(result.targetName)
	].join('\n');
}

export function formatTagDeleted(result: {
	tagName: string;
	tasksDeleted: number;
	switchedToMaster?: boolean;
}): string {
	result = sanitizeForTerminal(result);
	const tasks =
		result.tasksDeleted === 0
			? ''
			: result.tasksDeleted === 1
				? ' and its task'
				: ` and its ${result.tasksDeleted} tasks`;
	return (
		ok(`Deleted tag ${result.tagName}${tasks}`) +
		facts(result.switchedToMaster && 'switched to master')
	);
}

/**
 * Format the `tags` list as aligned rows with the current tag marked.
 *
 * @param tags - Tags in display order (current first)
 * @param options.showMetadata - Add the created date and description
 * @param options.ready - The list was filtered to tags with ready tasks
 * @param width - Terminal width; names and descriptions are cut to fit
 */
export function formatTagList(
	tags: TagSummary[],
	options: { showMetadata?: boolean; ready?: boolean } = {},
	width = terminalWidth()
): string {
	tags = sanitizeForTerminal(tags);
	if (tags.length === 0) {
		return options.ready ? 'No tag has a task ready to start' : 'No tags yet';
	}

	const numbers = ['Tasks', 'Ready', 'Done'];
	const dates = options.showMetadata
		? tags.map((tag) => {
				// A hand-edited date that doesn't parse leaves the cell empty
				const date = new Date(tag.created ?? '');
				return Number.isNaN(date.getTime())
					? ''
					: date.toISOString().slice(0, 10);
			})
		: [];
	const dateWidth = options.showMetadata ? 10 : 0;

	// Marker and space, the name, then each number column after two spaces
	const fixed =
		2 +
		numbers.reduce((sum, header) => sum + 2 + header.length, 0) +
		(options.showMetadata ? 2 + dateWidth : 0);
	const longest = Math.max(3, ...tags.map((tag) => tag.name.length));
	// With descriptions, names get at most half the space left over
	const nameRoom = options.showMetadata
		? Math.floor((width - fixed - 2) / 2)
		: width - fixed;
	const nameWidth = Math.max(8, Math.min(longest, nameRoom));
	const descriptionWidth = width - fixed - nameWidth - 2;
	// Too narrow for a useful description: show the date only
	const showDescription = options.showMetadata && descriptionWidth >= 8;

	const header = [
		'  ',
		'Tag'.padEnd(nameWidth),
		...numbers.map((label) => `  ${label}`),
		options.showMetadata ? `  ${'Created'.padEnd(dateWidth)}` : '',
		showDescription ? '  Description' : ''
	].join('');
	const lines = [theme.muted(header.trimEnd())];

	tags.forEach((tag, index) => {
		const marker = tag.isCurrent ? `${chalk.green('●')} ` : '  ';
		const name = fit(tag.name, nameWidth).padEnd(nameWidth);
		const values = [tag.taskCount, tag.readyTasks, tag.completedTasks];
		const cells = values.map((value, i) => {
			const text = String(value).padStart(numbers[i].length);
			return `  ${value === 0 ? theme.muted(text) : text}`;
		});
		let row = `${marker}${tag.isCurrent ? chalk.bold(name) : name}${cells.join('')}`;
		if (options.showMetadata) {
			const description =
				tag.description && showDescription
					? `  ${fit(tag.description, descriptionWidth)}`
					: '';
			const date = description ? dates[index].padEnd(dateWidth) : dates[index];
			if (date || description) row += theme.muted(`  ${date}${description}`);
		}
		lines.push(row.trimEnd());
	});

	return lines.join('\n');
}
