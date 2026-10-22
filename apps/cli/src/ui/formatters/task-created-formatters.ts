/**
 * @fileoverview What `add-task` prints once the task is saved, e.g.
 *
 *   ✓ Added task 4  Export bookmarks as a Netscape HTML file · medium priority
 *     Depends on  2  Email and password sign-in with sessions  added by AI
 *                 3  Bookmark CRUD endpoints                   added by AI
 *     Not used    1  Set up the database schema
 *   Next: taskgraph show 4 to read it, or taskgraph expand --id=4 to break it down
 *
 * It replaces a boxed "Task 4 Created Successfully" with the title, status
 * and priority repeated as labelled lines, a dependency list with titles cut
 * to 30 characters, a "Dependency Analysis" that counted the same
 * dependencies again, and a numbered "Next Steps" list of three commands.
 */

import chalk from 'chalk';
import { theme } from '../theme.js';
import { wrapLine } from './markdown-formatters.js';

export interface CreatedTaskDependency {
	id: number | string;
	/** Title of the task depended on; empty when it can't be found */
	title: string;
	/** The AI added it; you didn't pass it with --dependencies */
	addedByAi?: boolean;
}

export interface CreatedTask {
	id: number | string;
	title: string;
	priority?: string;
	/** What the new task depends on */
	dependencies: CreatedTaskDependency[];
	/** Dependencies you passed that the new task doesn't have */
	unused?: CreatedTaskDependency[];
}

const fit = (text: string, width: number) =>
	text.length > width
		? `${text.slice(0, Math.max(1, width - 1)).trimEnd()}…`
		: text;

/**
 * Format the confirmation after `add-task`.
 *
 * @param task - The saved task and its dependencies
 * @param width - Terminal width; titles are cut to fit
 */
export function formatTaskCreated(
	task: CreatedTask,
	width = process.stdout.columns || 80
): string {
	const lines: string[] = [];
	const priority = task.priority
		? theme.muted(` · ${task.priority} priority`)
		: '';
	const priorityLength = priority ? ` · ${task.priority} priority`.length : 0;
	const lead = `✓ Added task ${task.id}  `;
	const title = fit(
		task.title,
		Math.max(10, width - lead.length - priorityLength)
	);
	lines.push(
		`${chalk.green('✓')} Added task ${theme.brand(String(task.id))}  ${title}${priority}`
	);

	const groups: Array<[string, CreatedTaskDependency[]]> = [
		['Depends on', task.dependencies],
		['Not used', task.unused ?? []]
	];
	const all = groups.flatMap(([, deps]) => deps);
	if (all.length > 0) {
		const labelWidth = Math.max(
			...groups.filter(([, deps]) => deps.length).map(([l]) => l.length)
		);
		const idWidth = Math.max(...all.map((dep) => String(dep.id).length));
		const note = 'added by AI';
		const hasNote = all.some((dep) => dep.addedByAi);
		const fixed = 2 + labelWidth + 2 + idWidth + 2;
		const titleRoom = Math.max(
			10,
			width - fixed - (hasNote ? note.length + 2 : 0)
		);
		const titleWidth = Math.min(
			titleRoom,
			Math.max(...all.map((dep) => (dep.title || 'unknown task').length))
		);

		for (const [label, deps] of groups) {
			deps.forEach((dep, index) => {
				const name = fit(dep.title || 'unknown task', titleWidth);
				const row =
					`  ${(index === 0 ? label : '').padEnd(labelWidth)}  ` +
					`${theme.brand(String(dep.id).padEnd(idWidth))}  ` +
					(dep.addedByAi
						? `${name.padEnd(titleWidth)}  ${theme.muted(note)}`
						: name);
				lines.push(label === 'Not used' ? theme.muted(row) : row);
			});
		}
	}

	const next =
		`Next: ${theme.brand(`taskgraph show ${task.id}`)} to read it, or ` +
		`${theme.brand(`taskgraph expand --id=${task.id}`)} to break it down`;
	lines.push(...wrapLine(next, width, '      '));

	return lines.join('\n');
}
