/**
 * The dependency chain in the AI task context follows dependencies stored as
 * 3 or "3" (#290), as the legacy ContextGatherer test checked.
 */
import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { gatherTaskContext } from './task-context.js';

const task = (id: number, dependencies: Array<string | number>) =>
	({
		id,
		title: `Task ${id}`,
		description: `About ${id}`,
		status: 'pending',
		dependencies
	}) as unknown as Task;

describe('gatherTaskContext dependency chain', () => {
	it('follows string dependencies to tasks with numeric IDs', async () => {
		const tasks = [task(1, []), task(2, ['1']), task(3, [2])];

		const { items } = await gatherTaskContext(tasks, { dependencyIds: ['3'] });

		expect(items.map((item) => item.id)).toEqual(['3', '2', '1']);
	});
});
