import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../../../common/types/index.js';
import { createSubtask, createTask } from '../../../../testing/index.js';
import { setTaskStatusIn, withFreeIds } from './task-updates.js';

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
