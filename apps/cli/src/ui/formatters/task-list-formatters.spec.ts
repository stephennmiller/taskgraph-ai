import { stripVTControlCharacters } from 'node:util';
import type { Task } from '@tm/core';
import { createSubtask, createTask } from '@tm/core/testing';
import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';
import {
	formatEmptyList,
	formatInvalidDependencyWarning,
	formatListNextStep,
	formatListSummary,
	formatNoNextTask,
	formatPlainTaskList
} from './task-list-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);
const lines = (text: string) => plain(text).split('\n');
const widest = (text: string) =>
	Math.max(...lines(text).map((line) => line.length));

/** Tasks in every status, one expanded and in progress */
const project = (): Task[] => [
	createTask({ id: 1, title: 'Set up the database schema', status: 'done' }),
	createTask({
		id: 2,
		title: 'Email and password sign-in with sessions',
		status: 'in-progress',
		priority: 'high',
		dependencies: ['1'],
		subtasks: [
			createSubtask({
				id: 1,
				parentId: '2',
				title: 'Password hashing helpers',
				status: 'done'
			}),
			createSubtask({
				id: 2,
				parentId: '2',
				title: 'Sessions table and cookie middleware',
				status: 'pending',
				dependencies: [1]
			}),
			createSubtask({
				id: 3,
				parentId: '2',
				title: 'Sign-in rate limiting',
				status: 'pending',
				dependencies: [2]
			})
		]
	}),
	createTask({
		id: 3,
		title: 'Bookmark CRUD endpoints',
		dependencies: ['2']
	}),
	createTask({
		id: 4,
		title: 'Import bookmarks from a Netscape HTML export file',
		dependencies: ['3']
	}),
	createTask({
		id: 5,
		title: 'Tag bookmarks',
		status: 'review',
		priority: 'low',
		dependencies: ['3']
	}),
	createTask({ id: 6, title: 'Share by link', status: 'deferred' }),
	createTask({
		id: 7,
		title: 'Browser extension',
		status: 'blocked',
		dependencies: ['3']
	})
];

/** What `next` returns for the project: subtask 2.2 */
const nextSubtask = (): Task =>
	({
		id: '2.2',
		parentId: '2',
		title: 'Sessions table and cookie middleware',
		status: 'pending',
		priority: 'high',
		dependencies: ['2.1'],
		description: '',
		details: '',
		testStrategy: '',
		subtasks: []
	}) as Task;

describe('formatListSummary', () => {
	it('leads with task progress and counts each other status once', () => {
		const out = lines(formatListSummary(project(), null, { width: 80 }));

		expect(out[0]).toMatch(/^Tasks {5}\S+ {2}1 of 7 done · 14%$/);
		expect(out[1].trim()).toBe(
			'─ 1 deferred  ▓ 1 in progress  ▒ 1 review  ░ 2 pending  ! 1 blocked'
		);
	});

	it('counts subtasks from the tasks it is given (#246)', () => {
		const out = plain(formatListSummary(project(), null, { width: 80 }));

		expect(out).toMatch(/^Subtasks {2}\S+ {2}1 of 3 done · 33%$/m);
		expect(out).not.toContain('0/0');
	});

	it('leaves the subtask rows out when no task has subtasks', () => {
		const tasks = project().map((task) => ({ ...task, subtasks: [] }));

		expect(plain(formatListSummary(tasks, null))).not.toContain('Subtasks');
	});

	it('shows a subtask that next picks (#246)', () => {
		const out = plain(
			formatListSummary(project(), nextSubtask(), { width: 80 })
		);

		expect(out).toContain(
			'Next      2.2  Sessions table and cookie middleware · high priority'
		);
		expect(out).not.toContain('No task available');
	});

	it('says when nothing is ready instead of N/A rows', () => {
		const out = plain(formatListSummary(project(), null, { width: 80 }));

		expect(out).toContain('Next      nothing is ready to start');
		expect(out).not.toContain('N/A');
	});

	it('names the task that holds up the most others, while it is open', () => {
		const out = plain(formatListSummary(project(), null, { width: 80 }));

		expect(out).toContain(
			'Ready     2 ready · 4 waiting on dependencies · task 3 unblocks 3'
		);
	});

	it('leaves out a finished task as the one others wait on', () => {
		const tasks = [
			createTask({ id: 1, title: 'Base', status: 'done' }),
			createTask({ id: 2, title: 'A', dependencies: ['1'] }),
			createTask({ id: 3, title: 'B', dependencies: ['1'] })
		];

		expect(plain(formatListSummary(tasks, null))).not.toContain('unblocks');
	});

	it('draws a bar of the same width for any mix of statuses', () => {
		const bar = (tasks: Task[]) =>
			lines(formatListSummary(tasks, null, { width: 80 }))[0].split(/\s+/)[1];

		expect(bar(project())).toHaveLength(20);
		expect(
			bar([createTask({ id: 1, title: 'Only one', status: 'done' })])
		).toBe('█'.repeat(20));
	});

	it('fits 80 columns with a long next title', () => {
		const next = {
			...nextSubtask(),
			title:
				'A very long subtask title that goes on and on past the edge of an 80 column terminal'
		};

		const out = formatListSummary(project(), next, { width: 80 });

		expect(widest(out)).toBeLessThanOrEqual(80);
		expect(plain(out)).toContain('…');
	});

	it.each([50, 40])('wraps rows to %i columns', (width) => {
		const out = formatListSummary(project(), nextSubtask(), { width });

		expect(widest(out)).toBeLessThanOrEqual(width);
		// Continuation lines stay under the values, not under the labels
		for (const line of lines(out).slice(1)) {
			expect(line).toMatch(/^(Subtasks|Ready|Next| {10})/);
		}
	});

	it('has no box-drawing borders', () => {
		const out = plain(formatListSummary(project(), nextSubtask()));

		expect(out).not.toMatch(/[╭╮╰╯│┌┐└┘]/);
	});
});

describe('formatListNextStep', () => {
	it('suggests starting a pending next subtask', () => {
		expect(plain(formatListNextStep(nextSubtask(), { width: 80 }))).toBe(
			'Next: taskgraph set-status 2.2 in-progress to start working'
		);
	});

	it('does not suggest starting a task already in progress', () => {
		const next = createTask({
			id: 4,
			title: 'Wire up auth',
			status: 'in-progress'
		});

		const out = plain(formatListNextStep(next, { width: 80 }));

		expect(out).not.toContain('--status=in-progress');
		expect(out).toBe("Next: taskgraph note 4 '...' to log progress");
	});

	it('is empty when nothing is ready', () => {
		expect(formatListNextStep(null)).toBe('');
	});
});

describe('formatEmptyList', () => {
	it('says there are no tasks and how to add one', () => {
		const out = lines(formatEmptyList(undefined, { width: 80 }));

		expect(out[0]).toBe('No tasks found');
		expect(out[1]).toMatch(/^Next: taskgraph add-task/);
	});

	it('names the filter that matched nothing', () => {
		const out = lines(formatEmptyList('pending', { width: 80 }));

		expect(out[0]).toBe('No pending tasks found');
		expect(out[1]).toBe('Next: taskgraph list to see every task');
	});
});

describe('formatNoNextTask', () => {
	it('points to list when tasks exist but none is ready', () => {
		const out = lines(formatNoNextTask(true, { width: 80 }));

		expect(out[0]).toContain('All tasks are either completed');
		expect(out[1]).toBe('Next: taskgraph list to see them all');
	});

	it('says there are no tasks in an empty project', () => {
		expect(lines(formatNoNextTask(false))[0]).toBe('No tasks found');
	});
});

describe('formatPlainTaskList (#250)', () => {
	const level = chalk.level;
	afterEach(() => {
		chalk.level = level;
	});

	it('prints one aligned line per task with the full title and deps', () => {
		const output = formatPlainTaskList([
			createTask({
				id: 1,
				title: 'Set up the database schema',
				status: 'done',
				priority: 'high'
			}),
			createTask({
				id: 10,
				title:
					'Email and password sign-in with sessions, rate limits and a lockout after five failed attempts',
				status: 'in-progress',
				priority: 'medium',
				dependencies: ['1', '3']
			})
		]);

		expect(output.split('\n')).toEqual([
			'1   done         high    Set up the database schema',
			'10  in-progress  medium  Email and password sign-in with sessions, rate limits and a lockout after five failed attempts  deps:1,3'
		]);
	});

	it('has no ANSI codes or box characters, even when color is on', () => {
		chalk.level = 3;

		const output = formatPlainTaskList(project(), { withSubtasks: true });

		expect(output).not.toContain('\u001b');
		expect(output).not.toMatch(/[│┌┐└┘├┤─]/);
	});

	it('lists subtasks under their task with dotted IDs and deps', () => {
		const output = formatPlainTaskList(project().slice(1, 2), {
			withSubtasks: true
		});

		expect(output.split('\n')).toEqual([
			'2    in-progress  high    Email and password sign-in with sessions  deps:1',
			'2.1  done         medium  Password hashing helpers',
			'2.2  pending      medium  Sessions table and cookie middleware  deps:2.1',
			'2.3  pending      medium  Sign-in rate limiting  deps:2.2'
		]);
	});

	it('leaves subtasks out unless asked', () => {
		const output = formatPlainTaskList(project().slice(1, 2));

		expect(output.split('\n')).toHaveLength(1);
	});

	it('keeps a title with line breaks or control characters on one line', () => {
		const output = formatPlainTaskList([
			createTask({
				id: 1,
				title: 'First line\nsecond\tline\u0007',
				status: 'pending',
				priority: 'low'
			})
		]);

		expect(output).toBe('1  pending  low  First line second line');
	});

	it('keeps words apart across a carriage return or form feed', () => {
		const output = formatPlainTaskList([
			createTask({
				id: 1,
				title: 'Fix login\rretry\fnow',
				status: 'pending',
				priority: 'low'
			})
		]);

		expect(output).toBe('1  pending  low  Fix login retry now');
	});

	it('strips escape codes from every field, not only the title', () => {
		const output = formatPlainTaskList([
			{
				...createTask({
					id: 1,
					title: 'A',
					status: 'pending',
					priority: 'low',
					dependencies: ['2\u001b]0;pwned\u0007']
				}),
				tagName: 'ui\u001b[2J'
			}
		]);

		expect(output).toBe('ui  1  pending  low  A  deps:2');
	});

	it('starts each line with the tag when listing every tag', () => {
		const output = formatPlainTaskList([
			{
				...createTask({ id: 1, title: 'A', status: 'pending' }),
				tagName: 'master'
			},
			{ ...createTask({ id: 1, title: 'B', status: 'done' }), tagName: 'ui' }
		]);

		expect(output.split('\n').map((line) => line.split(/ {2,}/)[0])).toEqual([
			'master',
			'ui'
		]);
	});
});

describe('formatInvalidDependencyWarning (#366)', () => {
	const level = chalk.level;
	afterEach(() => {
		chalk.level = level;
	});

	it('names each missing dependency, and the tag when given', () => {
		const output = formatInvalidDependencyWarning(
			[{ taskId: '3', depId: '9' }],
			'feature'
		);

		expect(lines(output)).toEqual([
			'',
			'Warning: 1 invalid dependency reference(s) found (tag: feature):',
			'  Task 3 depends on non-existent task 9',
			'Run taskgraph fix-dependencies --tag feature to fix them'
		]);
	});

	it('puts <tag> in the command for a tag add-tag would refuse', () => {
		const output = lines(
			formatInvalidDependencyWarning(
				[{ taskId: '3', depId: '9' }],
				'a;rm -rf ~'
			)
		);

		expect(output[1]).toContain('(tag: a;rm -rf ~)');
		expect(output.at(-1)).toBe(
			'Run taskgraph fix-dependencies --tag <tag> to fix them'
		);
	});

	it('names five and counts the rest', () => {
		const invalid = Array.from({ length: 7 }, (_, i) => ({
			taskId: String(i + 1),
			depId: '99'
		}));

		const output = lines(formatInvalidDependencyWarning(invalid));

		expect(output).toHaveLength(9);
		expect(output.at(-2)).toBe('  ...and 2 more');
		expect(output.at(-1)).toBe('Run taskgraph fix-dependencies to fix them');
	});

	it('wraps every line to a 50-column terminal (#463)', () => {
		const output = formatInvalidDependencyWarning(
			[{ taskId: '12.3', depId: '45.6' }],
			'feature-branch',
			50
		);

		expect(widest(output)).toBeLessThanOrEqual(50);
		expect(lines(output)).toEqual([
			'',
			'Warning: 1 invalid dependency reference(s) found',
			'(tag: feature-branch):',
			'  Task 12.3 depends on non-existent task 45.6',
			'Run',
			'taskgraph fix-dependencies --tag feature-branch to',
			'fix them'
		]);
	});

	it('strips escape codes from the IDs and the tag', () => {
		chalk.level = 0;

		const output = formatInvalidDependencyWarning(
			[{ taskId: '3\u001b[2J', depId: '9\u001b]0;pwned\u0007' }],
			'x\u001b[31m\ny'
		);

		expect(output).not.toContain('\u001b');
		expect(output).not.toContain('\u0007');
		expect(output.split('\n')).toEqual([
			'',
			'Warning: 1 invalid dependency reference(s) found (tag: x y):',
			'  Task 3 depends on non-existent task 9',
			'Run taskgraph fix-dependencies --tag <tag> to fix them'
		]);
	});
});
