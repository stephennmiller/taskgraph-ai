/**
 * Manual add-dependency / remove-dependency keep the explicit-vs-inferred
 * marks (metadata.dependencySources) honest. Only tasks.json I/O is mocked.
 */

import { vi } from 'vitest';

const { readJSON, writeJSON } = vi.hoisted(() => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn()
}));

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON,
	writeJSON,
	log: vi.fn()
}));

import {
	addDependency,
	removeDependency
} from '../../../../../scripts/modules/dependency-manager.js';

const context = { projectRoot: '/project', tag: 'master' };

/** Run a dependency command on these tasks; return the tasks it wrote */
async function run(command, tasks, ...args) {
	readJSON.mockReturnValue({ tasks: structuredClone(tasks) });
	await command('tasks.json', ...args, context);
	return writeJSON.mock.calls[0][1].tasks;
}

const tasks = () => [
	{ id: 1, title: 'A', status: 'pending', dependencies: [] },
	{ id: 2, title: 'B', status: 'pending', dependencies: [] },
	{
		id: 3,
		title: 'C',
		status: 'pending',
		dependencies: [1],
		metadata: { jira: 'ABC-1', dependencySources: { 1: 'inferred' } }
	}
];

describe('dependency provenance on manual edits', () => {
	beforeEach(() => writeJSON.mockClear());

	it('adding a dependency leaves it explicit and keeps other marks', async () => {
		const written = await run(addDependency, tasks(), 3, 2);

		expect(written[2].dependencies.map(String)).toEqual(['1', '2']);
		expect(written[2].metadata.dependencySources).toEqual({ 1: 'inferred' });
	});

	it('re-adding a dependency over a stale inferred mark makes it explicit', async () => {
		const stale = tasks();
		stale[2].metadata.dependencySources = { 1: 'inferred', 2: 'inferred' };

		const written = await run(addDependency, stale, 3, 2);

		expect(written[2].metadata.dependencySources).toEqual({ 1: 'inferred' });
	});

	it('removing a dependency drops its inferred mark and keeps user metadata', async () => {
		const written = await run(removeDependency, tasks(), 3, 1);

		expect(written[2].dependencies).toEqual([]);
		expect(written[2].metadata).toEqual({ jira: 'ABC-1' });
	});

	it('leaves tasks without metadata free of a metadata field', async () => {
		const written = await run(addDependency, tasks(), 2, 1);

		expect(written[1].dependencies.map(String)).toEqual(['1']);
		expect(written[1]).not.toHaveProperty('metadata');
	});
});
