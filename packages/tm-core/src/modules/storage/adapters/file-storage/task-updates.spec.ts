import { describe, expect, it } from 'vitest';
import { createTask } from '../../../../testing/index.js';
import { withFreeIds } from './task-updates.js';

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
