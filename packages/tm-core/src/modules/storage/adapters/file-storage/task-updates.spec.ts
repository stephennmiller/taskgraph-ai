import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../../../common/types/index.js';
import { createSubtask, createTask } from '../../../../testing/index.js';
import {
	setTaskStatusIn,
	setTaskStatusesIn,
	withFreeIds
} from './task-updates.js';

const task = (id: string) => createTask({ id, title: `Task ${id}` });

describe('withFreeIds', () => {
	it('keeps free IDs and moves ones in use or reserved by the archive', () => {
		const existing = [task('1'), task('2')];
		const archive = { master: { tasks: [], metadata: { highestId: 4 } } };

		const { tasks, result } = withFreeIds(
			existing,
			[task('2'), task('3'), task('9')],
			archive,
			'master'
		);

		expect(result.map((t) => t.id)).toEqual(['5', '6', '9']);
		expect(tasks.map((t) => t.id)).toEqual(['1', '2', '5', '6', '9']);
	});

	it('stamps createdAt on a new task and keeps one it already has (#1015)', () => {
		const moved = createTask({
			id: '2',
			title: 'Moved',
			createdAt: '2020-01-01T00:00:00.000Z'
		});

		const { result } = withFreeIds([], [task('1'), moved], {}, 'master');

		expect(Date.parse(result[0].createdAt ?? '')).not.toBeNaN();
		expect(result[1].createdAt).toBe('2020-01-01T00:00:00.000Z');
	});
});

describe('setTaskStatusIn parent auto-status', () => {
	const parent = (status: TaskStatus, sub1: TaskStatus) => [
		createTask({
			id: '1',
			title: 'One',
			status,
			subtasks: [
				createSubtask({ id: 1, title: 'A', status: sub1 }),
				createSubtask({ id: 2, title: 'B', status: 'pending' })
			]
		})
	];

	it('marks the parent done when its subtasks are done or cancelled', () => {
		const { tasks } = setTaskStatusIn(
			parent('in-progress', 'done'),
			'1.2',
			'cancelled',
			{}
		);

		expect(tasks?.[0].status).toBe('done');
	});

	it('keeps the claim on a parent its subtasks finish, drops it when they go back to pending (#1034)', () => {
		const [claimed] = parent('in-progress', 'done');
		const tasks = [{ ...claimed, metadata: { claimedBy: 'alice' } }];

		const { tasks: finished } = setTaskStatusIn(tasks, '1.2', 'done', {});
		const [reset] = parent('in-progress', 'pending');
		const { tasks: given } = setTaskStatusIn(
			[
				{
					...reset,
					subtasks: [
						reset.subtasks[0],
						{ ...reset.subtasks[1], status: 'in-progress' }
					],
					metadata: { claimedBy: 'alice' }
				}
			],
			'1.2',
			'pending',
			{}
		);

		expect(finished?.[0].status).toBe('done');
		expect(finished?.[0].metadata).toMatchObject({ claimedBy: 'alice' });
		expect(given?.[0].status).toBe('pending');
		expect(given?.[0].metadata).toBeUndefined();
	});

	it('leaves a parent in review for the user when its last subtask finishes (#1042)', () => {
		const { tasks } = setTaskStatusIn(
			parent('review', 'done'),
			'1.2',
			'done',
			{}
		);

		expect(tasks?.[0].status).toBe('review');
	});

	it('keeps a parent marked done when a leftover subtask is cancelled or finished, reopens it when one is started (#1107)', () => {
		const done = () => parent('done', 'pending');

		const cancelled = setTaskStatusIn(done(), '1.1', 'cancelled', {}).tasks;
		const finished = setTaskStatusIn(done(), '1.1', 'done', {}).tasks;
		const started = setTaskStatusIn(done(), '1.1', 'in-progress', {}).tasks;

		expect(cancelled?.[0].status).toBe('done');
		expect(finished?.[0].status).toBe('done');
		expect(started?.[0].status).toBe('in-progress');
	});

	it.each(['deferred', 'blocked', 'review'] as const)(
		'keeps a parent marked done when a leftover subtask is set %s, so cancelling it later leaves the parent done (#1107)',
		(held) => {
			const first = setTaskStatusIn(parent('done', 'pending'), '1.1', held, {});
			const then = setTaskStatusIn(first.tasks ?? [], '1.1', 'cancelled', {});

			expect(first.tasks?.[0].status).toBe('done');
			expect(then.tasks?.[0].status).toBe('done');
		}
	);

	it('reopens a parent marked done when a finished subtask is set blocked', () => {
		const { tasks } = setTaskStatusIn(
			parent('done', 'done'),
			'1.1',
			'blocked',
			{}
		);

		expect(tasks?.[0].status).toBe('in-progress');
	});

	it('leaves the parent as it was when every subtask is cancelled', () => {
		const { tasks } = setTaskStatusIn(
			parent('pending', 'cancelled'),
			'1.2',
			'cancelled',
			{}
		);

		expect(tasks?.[0].status).toBe('pending');
	});
});

describe('setTaskStatusesIn', () => {
	it('applies every id in order, including a parent that finishes last', () => {
		const tasks = [
			createTask({
				id: '1',
				title: 'One',
				status: 'pending',
				subtasks: [
					createSubtask({ id: 1, title: 'A', status: 'pending' }),
					createSubtask({ id: 2, title: 'B', status: 'pending' })
				]
			})
		];

		const { tasks: updated, result } = setTaskStatusesIn(
			tasks,
			['1.1', '1.2'],
			'done',
			{}
		);

		expect(result.map((change) => change.taskId)).toEqual(['1.1', '1.2']);
		expect(updated?.[0].subtasks?.map((sub) => sub.status)).toEqual([
			'done',
			'done'
		]);
		expect(updated?.[0].status).toBe('done');
		expect(tasks[0].status).toBe('pending');
	});

	it('names the missing id and leaves the tasks it was given unchanged', () => {
		const tasks = [task('10'), task('11')];
		let caught: unknown;
		try {
			setTaskStatusesIn(tasks, ['10', '99'], 'done', {});
		} catch (error) {
			caught = error;
		}

		expect(caught).toMatchObject({
			message: 'Task 99 not found',
			context: { taskId: '99' }
		});
		expect(tasks.map((item) => item.status)).toEqual(['pending', 'pending']);
	});

	it('applies nothing when a later id is refused', () => {
		const tasks = [task('1'), task('2')];
		const refusal = new Error('refused');

		expect(() =>
			setTaskStatusesIn(tasks, ['1', '2'], 'done', {
				guardDone: (_task, id) => (id === '2' ? refusal : undefined)
			})
		).toThrow(refusal);
		expect(tasks.map((item) => item.status)).toEqual(['pending', 'pending']);
	});
});
