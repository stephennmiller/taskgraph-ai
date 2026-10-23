import { stripVTControlCharacters } from 'node:util';
import type { Task } from '@tm/core';
import { createSubtask, createTask } from '@tm/core/testing';
import { describe, expect, it } from 'vitest';
import {
	formatEmptyList,
	formatListNextStep,
	formatListSummary,
	formatNoNextTask
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
			'Next: taskgraph set-status --id=2.2 --status=in-progress to start working'
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
		expect(out).toBe('Next: taskgraph note 4 "..." to log progress');
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
