/**
 * @fileoverview The task list `sync-readme` writes into README.md: a
 * progress table and one row per task, between export markers, so a later
 * sync replaces the section and leaves the rest of the README alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
import type { Task } from '../../../common/types/index.js';
import { resolvePathInsideRoot } from '../../../common/utils/path-inside-root.js';
import { writeAtomically } from '../../../common/utils/write-atomically.js';

export interface ReadmeExportOptions {
	/** Include each task's subtasks as rows */
	withSubtasks?: boolean;
	/** Only tasks with this status, or a comma-separated list; 'all' for every task */
	status?: string;
}

const START = '<!-- TASKGRAPH_EXPORT_START -->';
const END = '<!-- TASKGRAPH_EXPORT_END -->';

const STATUS_LABELS: Record<string, string> = {
	done: '✓&nbsp;done',
	'in-progress': '►&nbsp;in-progress',
	pending: '○&nbsp;pending',
	blocked: '⭕&nbsp;blocked',
	deferred: 'x&nbsp;deferred',
	cancelled: 'x&nbsp;cancelled',
	review: '?&nbsp;review'
};

const statusLabel = (status: string | undefined) =>
	(status && STATUS_LABELS[status]) || status || 'pending';

const progressBar = (percentage: number, width = 20) => {
	const filled = Math.round((percentage / 100) * width);
	return '█'.repeat(filled) + '░'.repeat(width - filled);
};

const percent = (part: number, total: number) =>
	total > 0 ? (part / total) * 100 : 0;

// A title is one table cell: no row breaks, no column breaks, no export markers
const cell = (text: string) =>
	text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').replace(/<!--/g, '&lt;!--');

const dependencyList = (deps: unknown[] | undefined) =>
	deps && deps.length > 0 ? deps.join(', ') : 'None';

/**
 * The markdown table for README.md: counts over every task in the tag, rows
 * for the tasks the status filter keeps
 */
export function renderReadmeTasks(
	tasks: Task[],
	{ withSubtasks = false, status }: ReadmeExportOptions = {}
): string {
	const allowed =
		status && status.toLowerCase() !== 'all'
			? status
					.split(',')
					.map((s) => s.trim().toLowerCase())
					.filter((s) => s.length > 0)
			: null;
	const shown = allowed
		? tasks.filter(
				(task) => task.status && allowed.includes(task.status.toLowerCase())
			)
		: tasks;

	const count = (items: { status?: string }[], wanted: string) =>
		items.filter((item) => item.status === wanted).length;
	const subtasks = tasks.flatMap((task) => task.subtasks ?? []);
	const done = count(tasks, 'done');
	const subtasksDone = count(subtasks, 'done');
	const taskPercentage = percent(done, tasks.length);
	const subtaskPercentage = percent(subtasksDone, subtasks.length);

	let markdown = '';
	markdown += '| Project Dashboard |  |\n';
	markdown += '| :-                |:-|\n';
	markdown += `| Task Progress     | ${progressBar(taskPercentage)} ${Math.round(taskPercentage)}% |\n`;
	markdown += `| Done | ${done} |\n`;
	markdown += `| In Progress | ${count(tasks, 'in-progress')} |\n`;
	markdown += `| Pending | ${count(tasks, 'pending')} |\n`;
	markdown += `| Deferred | ${count(tasks, 'deferred')} |\n`;
	markdown += `| Cancelled | ${count(tasks, 'cancelled')} |\n`;
	markdown += '|-|-|\n';
	markdown += `| Subtask Progress | ${progressBar(subtaskPercentage)} ${Math.round(subtaskPercentage)}% |\n`;
	markdown += `| Completed | ${subtasksDone} |\n`;
	markdown += `| In Progress | ${count(subtasks, 'in-progress')} |\n`;
	markdown += `| Pending | ${count(subtasks, 'pending')} |\n`;
	markdown += '\n\n';
	markdown +=
		'| ID | Title | Status | Priority | Dependencies | Complexity |\n';
	markdown +=
		'| :- | :-    | :-     | :-       | :-           | :-         |\n';

	for (const task of shown) {
		// tm-core gives the report's score as `complexity`; older files stored complexityScore
		const score =
			task.complexity ?? (task as { complexityScore?: number }).complexityScore;
		const complexity = score ? `● ${score}` : 'N/A';
		markdown += `| ${task.id} | ${cell(task.title)} | ${statusLabel(task.status)} | ${task.priority || 'medium'} | ${dependencyList(task.dependencies)} | ${complexity} |\n`;

		if (!withSubtasks) continue;
		for (const subtask of task.subtasks ?? []) {
			const subtaskScore = (subtask as { complexityScore?: number })
				.complexityScore;
			markdown += `| ${task.id}.${subtask.id} | ${cell(subtask.title)} | ${statusLabel(subtask.status)} | -            | ${dependencyList(subtask.dependencies)} | ${subtaskScore ? String(subtaskScore) : 'N/A'} |\n`;
		}
	}

	return markdown;
}

/**
 * The export section, markers included, around a rendered task list
 * @param timestamp - When the export ran, as shown in the section
 */
function readmeSection(
	tasksMarkdown: string,
	{
		timestamp,
		withSubtasks = false,
		status,
		projectRoot
	}: ReadmeExportOptions & { timestamp: string; projectRoot: string }
): string {
	const info =
		`🎯 **TaskGraph Export** - ${timestamp}\n` +
		`📋 Export: ${withSubtasks ? 'with subtasks' : 'without subtasks'} • ${status ? `Status filter: ${status}` : 'Status filter: none'}\n` +
		`🔗 Powered by [TaskGraph](${taskGraphUrl(projectRoot)})`;
	return (
		`${START}\n> ${info.split('\n').join('\n> ')}\n\n` +
		tasksMarkdown +
		'\n> 📋 **End of TaskGraph Export** - Tasks are synced from your project using the `sync-readme` command.\n' +
		`${END}\n`
	);
}

/**
 * README.md with the export section replaced, or appended when it has none
 * @param readme - The current README, or null when there is none
 */
export function mergeReadmeSection(
	readme: string | null,
	section: string,
	projectName: string
): string {
	const current =
		readme ??
		`# ${projectName}\n\nThis project is managed using TaskGraph.\n\n`;
	const start = current.indexOf(START);
	const end = start === -1 ? -1 : current.indexOf(END, start);
	// Appending here would let the next sync delete the text after the orphan
	if (start !== -1 && end === -1) {
		throw errorWithHint(
			ERROR_CODES.INVALID_INPUT,
			`README.md has ${START} with no ${END} after it`,
			`Add ${END} where the old export ends, or delete ${START}, then run sync-readme again`
		);
	}
	if (start !== -1) {
		return (
			current.substring(0, start) +
			section +
			current.substring(end + END.length)
		);
	}
	return `${current}\n${section}`;
}

/**
 * Write the export section into the project's README.md, creating the file
 * when there is none
 * @returns The README's path
 */
export function writeReadmeExport(
	projectRoot: string,
	tasks: Task[],
	options: ReadmeExportOptions & { projectName: string }
): string {
	const readmePath = path.join(projectRoot, 'README.md');
	// A symlinked README keeps its link, but only to a file inside the project
	const target = resolvePathInsideRoot(
		fs.realpathSync(projectRoot),
		readmePath
	);
	if (target === null) {
		throw errorWithHint(
			ERROR_CODES.INVALID_INPUT,
			`README.md links to a file outside ${projectRoot}`,
			'Point README.md at a file inside the project, or replace the link with a regular file'
		);
	}
	let readme: string | null = null;
	try {
		readme = fs.readFileSync(target, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	const section = readmeSection(renderReadmeTasks(tasks, options), {
		...options,
		timestamp: `${new Date().toISOString().replace('T', ' ').substring(0, 19)} UTC`,
		projectRoot
	});
	writeAtomically(
		target,
		mergeReadmeSection(readme, section, options.projectName)
	);
	return readmePath;
}

/** The product link, tagged with the project's folder name */
function taskGraphUrl(projectRoot: string): string {
	const campaign = path
		.basename(projectRoot)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
	const params = new URLSearchParams({
		utm_source: 'github-readme',
		utm_medium: 'readme-export',
		utm_campaign: campaign || 'task-sync',
		utm_content: 'task-export-link'
	});
	return `https://github.com/stephennmiller/taskgraph-ai?${params.toString()}`;
}
