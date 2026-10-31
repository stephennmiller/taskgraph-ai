/**
 * createTaskLookup: which IDs name a task or subtask, as validate-dependencies
 * and add-dependency check them.
 */

import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { createTaskLookup } from './dependency-check.js';

const asTasks = (tasks: Record<string, any>[]) => tasks as unknown as Task[];

describe('createTaskLookup', () => {
	it('finds tasks and subtasks by number or stored string ID, the first task winning', () => {
		const exists = createTaskLookup(
			asTasks([
				{ id: 1, subtasks: [{ id: 1 }, { id: 2 }] },
				{ id: 1, subtasks: [{ id: 9 }] },
				{ id: '4', subtasks: [{ id: '1' }] },
				{ id: 3, subtasks: [] }
			])
		);

		for (const id of [1, '1', '1.1', '1.2', '4', '4.1']) {
			expect(exists(id), `id ${id}`).toBe(true);
		}
		// #864: "1.01" and "1.1x" passed here but not the loop check, hiding loops
		for (const id of [
			...[0, '', '2', '1.9', '3.1', '3.y', 'x.1', 'x', '.1'],
			...['01', '1.01', '01.1', '1.1x', '1.2.3', ' 1']
		]) {
			expect(exists(id), `id ${id}`).toBe(false);
		}
	});
});
