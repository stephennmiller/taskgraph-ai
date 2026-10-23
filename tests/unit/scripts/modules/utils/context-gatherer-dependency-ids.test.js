/**
 * The AI context for add-task follows dependencies whether a task stores
 * them as 3 or "3" (#290: top-level dependencies are stored as strings).
 * Only tasks.json I/O is mocked.
 */

import { vi } from 'vitest';

const { readJSON } = vi.hoisted(() => ({ readJSON: vi.fn() }));

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON
}));

import { ContextGatherer } from '../../../../../scripts/modules/utils/contextGatherer.js';

const task = (id, dependencies) => ({
	id,
	title: `Task ${id}`,
	description: `About ${id}`,
	status: 'pending',
	dependencies
});

describe('ContextGatherer dependency chain', () => {
	it('follows dependencies stored as strings to tasks with numeric IDs', () => {
		readJSON.mockReturnValue({
			tasks: [task(1, []), task(2, ['1']), task(3, [2])]
		});
		const gatherer = new ContextGatherer('/project', 'master');

		const context = gatherer._buildDependencyContext(['3']);

		expect(context).toContain('Direct dependencies:\n- Task 3');
		expect(context).toContain('- Task 2: Task 2');
		expect(context).toContain('- Task 1: Task 1');
	});
});
