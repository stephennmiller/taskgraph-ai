/**
 * @fileoverview What `taskgraph show <id>` prints, e.g.
 *
 *   Task 2  Email and password sign-in with sessions
 *   ▶ in-progress · high priority · complexity 7 (high) · depends on 1
 *   From docs/prd.md#authentication
 *
 *   Let people create an account with an email and password, sign in, and
 *   stay signed in across browser restarts.
 *
 *   Details
 *     Hash passwords with bcrypt (cost 12). Store sessions in the sessions
 *     table with a 30-day sliding expiry.
 *
 *   Test strategy
 *     Integration test that signs up, signs in and restarts the server.
 *
 *   Subtasks · 1 of 3 done
 *     2.1  ✓ done         Password hashing helpers
 *     2.2  ▶ in-progress  Sessions table and cookie middleware  after 2.1
 *     2.3  ○ pending      Sign-in rate limiting                 after 2.2
 *
 *   Next: taskgraph update-task --id=2 --prompt="..." to update details
 *
 * It replaces a boxed title, a bordered two-column table whose labels
 * slipped out of line with their values when a value wrapped, a box for each
 * of up to ten sections, a boxed "Subtasks" heading over a bordered table,
 * and a boxed, numbered list of suggested actions.
 */

import {
	type Subtask,
	type Task,
	type TaskChecklist,
	type TaskStatus,
	buildChecklist,
	getPrdSource,
	resolveSubtaskDependency
} from '@tm/core';
import chalk from 'chalk';
import { toMarkdown } from '../../utils/content-renderer.js';
import { getSuggestedActions } from '../suggested-actions.js';
import { terminalWidth, wrapLine } from '../layout/helpers.js';
import { theme } from '../theme.js';
import { formatChecklist } from './checklist-formatters.js';
import { complexityLevel } from './complexity-formatters.js';
import {
	fit,
	formatMarkdown,
	terminalSafe,
	visibleLength
} from './markdown-formatters.js';
import { getPriorityWithColor } from './priority-formatters.js';
import { getStatusWithColor } from './status-formatters.js';

/** Text wraps at the terminal width, but no wider than this */
const MAX_WIDTH = 100;
/** Section bodies sit under their heading */
const INDENT = '  ';

export interface TaskDetailOptions {
	/**
	 * The ID as the user asked for it. A subtask object only knows its own
	 * number, so pass `2.3` when showing subtask 3 of task 2.
	 */
	id?: string;
	/**
	 * The task's acceptance criteria and the project's Definition of Done
	 * (`tasks.getChecklist`). Without it, only the task's own criteria show.
	 */
	checklist?: TaskChecklist;
	/** Only list subtasks with this status (`show --status`) */
	statusFilter?: string;
	/** Terminal width */
	width?: number;
}

/**
 * A copy of the task with every string made safe to print, so text in a
 * task file can't send escape sequences to the terminal
 */
function safeStrings<T>(value: T): T {
	if (typeof value === 'string') return terminalSafe(value) as T;
	if (Array.isArray(value)) return value.map(safeStrings) as T;
	if (value && typeof value === 'object' && !(value instanceof Date)) {
		return Object.fromEntries(
			Object.entries(value).map(([key, item]) => [key, safeStrings(item)])
		) as T;
	}
	return value;
}

/** `1`, `1 and 3`, `1, 3 and 4` */
const listIds = (ids: string[]) =>
	ids.length <= 1
		? ids.join('')
		: `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;

const isSubtask = (task: Task | Subtask): task is Subtask =>
	'parentId' in task && task.parentId !== undefined;

/** Full IDs of what a task or subtask depends on (`2.1` for a sibling) */
function dependencyIds(task: Task | Subtask): string[] {
	const deps = task.dependencies ?? [];
	return isSubtask(task)
		? deps.map((dep) => resolveSubtaskDependency(task.parentId, dep))
		: deps.map(String);
}

/** Lines of `text`, each prefixed with `indent` and fitting `width` */
function wrapIndented(text: string, width: number, indent = INDENT): string[] {
	return wrapLine(text, width - indent.length, '').map((line) => indent + line);
}

/** Render stored markdown or HTML, indented under a heading */
function body(content: string, width: number, indent = INDENT): string[] {
	const columns = Math.max(20, width - indent.length);
	return formatMarkdown(toMarkdown(content), columns, { breaks: true })
		.split('\n')
		.map((line) => (line.trim() ? indent + line : ''));
}

/**
 * `Task 2  Email and password…`, with a long title wrapped under itself
 */
function header(label: string, title: string, width: number): string[] {
	const lead = `${label}  `;
	const [first, ...rest] = wrapLine(title, width - lead.length, '');
	const pad = ' '.repeat(lead.length);
	return [
		theme.brand.bold(label) + '  ' + chalk.bold(first),
		...rest.map((line) => pad + chalk.bold(line))
	];
}

/** Join facts with ` · `, starting a new line rather than splitting one */
function joinFacts(facts: string[], width: number): string[] {
	const lines: string[] = [];
	let line = '';
	for (const fact of facts) {
		const next = line ? `${line}${theme.muted(' · ')}${fact}` : fact;
		if (line && visibleLength(next) > width) {
			lines.push(line);
			line = fact;
		} else {
			line = next;
		}
	}
	if (line) lines.push(line);
	return lines;
}

/** `▶ in-progress · high priority · complexity 7 · depends on 1` */
function facts(task: Task | Subtask, width: number): string[] {
	const parts = [getStatusWithColor(task.status as TaskStatus)];
	if (task.priority) {
		parts.push(`${getPriorityWithColor(task.priority)} priority`);
	}
	if (typeof task.complexity === 'number') {
		const level = complexityLevel(task.complexity).toLowerCase();
		parts.push(theme.muted(`complexity ${task.complexity} (${level})`));
	}
	const deps = dependencyIds(task);
	if (deps.length > 0) {
		parts.push(theme.muted(`depends on ${listIds(deps)}`));
	}
	if (task.category) parts.push(theme.muted(task.category));
	if (task.skills && task.skills.length > 0) {
		parts.push(theme.accent(task.skills.join(', ')));
	}
	return joinFacts(parts, width);
}

/** `From docs/prd.md#authentication`: the PRD section parse-prd made it from */
function sourceLine(task: Task | Subtask, width: number): string[] {
	const source = getPrdSource(task);
	if (!source) return [];
	return [theme.muted('From ') + theme.text(fit(source, width - 5))];
}

const heading = (text: string, note?: string) =>
	theme.heading(text) + (note ? theme.muted(` · ${note}`) : '');

/** `create  src/routes/bookmarks.ts  New router for the endpoints` */
function fileRows(task: Task | Subtask, width: number): string[] {
	// Older or hand-edited files may leave out a field
	const files = (task.relevantFiles ?? []).map((file) => ({
		path: file.path ?? '',
		action: file.action ?? '',
		description: file.description
	}));
	const pathWidth = Math.max(...files.map((file) => file.path.length));
	const actionWidth = Math.max(...files.map((file) => file.action.length));
	const lead = INDENT.length + actionWidth + 2;
	return files.flatMap((file) => {
		const action = file.action.padEnd(actionWidth);
		const start = `${INDENT}${theme.muted(action)}  `;
		const descWidth = width - lead - pathWidth - 2;
		if (!file.description) return [start + theme.text(file.path)];
		if (descWidth >= 20) {
			return [
				`${start}${theme.text(file.path.padEnd(pathWidth))}  ${theme.muted(fit(file.description, descWidth))}`
			];
		}
		return [
			start + theme.text(file.path),
			...wrapIndented(file.description, width, ' '.repeat(lead)).map((line) =>
				theme.muted(line)
			)
		];
	});
}

/** `requireUser  src/middleware/auth.ts` and how to use it underneath */
function infrastructureRows(task: Task | Subtask, width: number): string[] {
	return (task.existingInfrastructure ?? []).flatMap((item) => [
		`${INDENT}${theme.text(item.name ?? '')}  ${theme.muted(item.location ?? '')}`,
		...(item.usage ? wrapIndented(item.usage, width, INDENT.repeat(2)) : [])
	]);
}

/** One wrapped line per item, with the marker hanging */
function listRows(items: string[], marker: string, width: number): string[] {
	const hang = ' '.repeat(INDENT.length + marker.length + 1);
	return items.flatMap((item) =>
		wrapLine(`${INDENT}${marker} ${item}`, width, hang)
	);
}

/** `In   CRUD for the user's own bookmarks` / `Out  Sharing and tags` */
function scopeRows(task: Task | Subtask, width: number): string[] {
	const scope = task.scopeBoundaries;
	if (!scope) return [];
	const rows: string[] = [];
	const hang = ' '.repeat(INDENT.length + 5);
	if (scope.included) {
		rows.push(...wrapLine(`${INDENT}In   ${scope.included}`, width, hang));
	}
	if (scope.excluded) {
		rows.push(
			...wrapLine(`${INDENT}Out  ${scope.excluded}`, width, hang).map((line) =>
				theme.muted(line)
			)
		);
	}
	return rows;
}

/** Aligned rows: `2.2  ▶ in-progress  Sessions table…  after 2.1` */
function subtaskRows(
	parentId: string,
	subtasks: Subtask[],
	width: number
): string[] {
	const rows = subtasks.map((subtask) => {
		// A subtask's ID is usually its own number, but may already be dotted
		const id = String(subtask.id).includes('.')
			? String(subtask.id)
			: `${parentId}.${subtask.id}`;
		const deps = (subtask.dependencies ?? []).map((dep) =>
			resolveSubtaskDependency(parentId, dep)
		);
		return {
			id,
			status: subtask.status as TaskStatus,
			statusText: `x ${subtask.status}`,
			title: subtask.title,
			after: deps.length > 0 ? `after ${deps.join(', ')}` : ''
		};
	});
	const idWidth = Math.max(...rows.map((row) => row.id.length));
	const statusWidth = Math.max(...rows.map((row) => row.statusText.length));
	const afterWidth = Math.max(...rows.map((row) => row.after.length));
	const fixed = INDENT.length + idWidth + 2 + statusWidth + 2;
	// Drop the "after" column before cutting titles to almost nothing
	const showAfter = afterWidth > 0 && width - fixed - afterWidth - 2 >= 20;
	const titleRoom = Math.max(
		10,
		width - fixed - (showAfter ? afterWidth + 2 : 0)
	);
	const titleWidth = Math.min(
		titleRoom,
		Math.max(...rows.map((row) => row.title.length))
	);

	return rows.flatMap((row) => {
		const status =
			getStatusWithColor(row.status) +
			' '.repeat(statusWidth - row.statusText.length);
		const title = fit(row.title, titleWidth);
		const line = `${INDENT}${theme.brand(row.id.padEnd(idWidth))}  ${status}  ${title}`;
		if (!row.after) return [line];
		if (showAfter) {
			return [
				`${line}${' '.repeat(titleWidth - title.length)}  ${theme.muted(row.after)}`
			];
		}
		// Too narrow for the column: keep the dependencies on their own line
		return [line, theme.muted(' '.repeat(fixed) + row.after)];
	});
}

/** The subtasks section, filtered by status when asked */
function subtaskSection(
	parentId: string,
	subtasks: Subtask[],
	statusFilter: string | undefined,
	width: number
): string[] {
	if (statusFilter) {
		const matching = subtasks.filter((sub) => sub.status === statusFilter);
		if (matching.length === 0) {
			return [theme.muted(`No ${statusFilter} subtasks`)];
		}
		return [
			heading(
				'Subtasks',
				`${matching.length} of ${subtasks.length} ${statusFilter}`
			),
			...subtaskRows(parentId, matching, width)
		];
	}
	const done = subtasks.filter(
		(sub) => sub.status === 'done' || sub.status === 'completed'
	).length;
	return [
		heading('Subtasks', `${done} of ${subtasks.length} done`),
		...subtaskRows(parentId, subtasks, width)
	];
}

/** `Next: taskgraph set-status --id=2 --status=done when it is finished` */
function nextStep(
	id: string,
	status: string | undefined,
	hasSubtasks: boolean,
	width: number
): string[] {
	const [action] = getSuggestedActions(id, status, hasSubtasks);
	if (!action) return [];
	const line = `Next: ${theme.brand(action.command)} ${action.description}`;
	return wrapLine(line, width, '      ');
}

/**
 * Format everything `show` prints about one task or subtask.
 *
 * @param taskToShow - The task, or a subtask (pass `options.id` as `2.3`)
 * @param options - The ID as asked for, a subtask status filter, the width
 */
export function formatTaskDetail(
	taskToShow: Task | Subtask,
	options: TaskDetailOptions = {}
): string {
	const task = safeStrings(taskToShow);
	const width = Math.max(
		30,
		Math.min(options.width ?? terminalWidth(), MAX_WIDTH)
	);
	const id = options.id ?? String(task.id);
	const label = id.includes('.') ? `Subtask ${id}` : `Task ${id}`;
	const sections: string[][] = [];

	sections.push([
		...header(label, task.title, width),
		...facts(task, width),
		...sourceLine(task, width)
	]);

	if (task.description) sections.push(body(task.description, width, ''));

	const textSections: Array<[string, string | undefined]> = [
		['Details', task.details],
		['Test strategy', task.testStrategy],
		['Approach', task.implementationApproach]
	];
	for (const [title, text] of textSections) {
		if (text?.trim()) sections.push([heading(title), ...body(text, width)]);
	}

	if (task.relevantFiles?.length) {
		sections.push([heading('Files'), ...fileRows(task, width)]);
	}
	if (task.existingInfrastructure?.length) {
		sections.push([
			heading('Existing code'),
			...infrastructureRows(task, width)
		]);
	}
	if (task.codebasePatterns?.length) {
		sections.push([
			heading('Patterns'),
			...listRows(task.codebasePatterns, '•', width)
		]);
	}
	if (task.scopeBoundaries?.included || task.scopeBoundaries?.excluded) {
		sections.push([heading('Scope'), ...scopeRows(task, width)]);
	}
	if (task.technicalConstraints?.length) {
		sections.push([
			heading('Constraints'),
			...listRows(task.technicalConstraints, '•', width)
		]);
	}
	// Numbered as `set-status --check` takes them
	const checklist = safeStrings(
		options.checklist ?? buildChecklist(taskToShow, [])
	);
	if (checklist.items.length > 0) {
		sections.push([formatChecklist(checklist, width)]);
	}

	const subtasks = isSubtask(task) ? [] : (task.subtasks ?? []);
	if (subtasks.length > 0) {
		sections.push(
			subtaskSection(String(task.id), subtasks, options.statusFilter, width)
		);
	}

	const next = nextStep(id, task.status, subtasks.length > 0, width);
	if (next.length > 0) sections.push(next);

	return sections.map((lines) => lines.join('\n')).join('\n\n');
}
