/**
 * Manual add-dependency / remove-dependency / fix-dependencies keep the
 * explicit-vs-inferred marks (metadata.dependencySources) honest. Only
 * tasks.json I/O is mocked.
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
	fixDependenciesCommand,
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

const withSubtasks = () => [
	{
		id: 2,
		title: 'Parent',
		status: 'pending',
		dependencies: [],
		subtasks: [
			{ id: 1, title: 'S1', status: 'pending', dependencies: [] },
			{ id: 2, title: 'S2', status: 'pending', dependencies: [] },
			{
				id: 3,
				title: 'S3',
				status: 'pending',
				// the sibling is stored as a bare number; its mark is keyed by full ID
				dependencies: [1],
				metadata: { dependencySources: { 2.1: 'inferred' } }
			}
		]
	}
];

describe('dependency provenance on manual edits', () => {
	beforeEach(() => writeJSON.mockClear());

	it('characterization: adding an unrelated dependency leaves other marks alone', async () => {
		const written = await run(addDependency, tasks(), 3, 2);

		expect(written[2].dependencies.map(String)).toEqual(['1', '2']);
		expect(written[2].metadata.dependencySources).toEqual({ 1: 'inferred' });
	});

	it('adding a dependency that is already present and inferred makes it explicit', async () => {
		const written = await run(addDependency, tasks(), 3, 1);

		expect(written[2].dependencies).toEqual([1]);
		expect(written[2].metadata).toEqual({ jira: 'ABC-1' });
	});

	it('adding a dependency that is already present and explicit writes nothing', async () => {
		const plain = tasks();
		plain[2].metadata = { jira: 'ABC-1' };
		readJSON.mockReturnValue({ tasks: plain });
		await addDependency('tasks.json', 3, 1, context);

		expect(writeJSON).not.toHaveBeenCalled();
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

	it('characterization: tasks without metadata stay free of a metadata field', async () => {
		const written = await run(addDependency, tasks(), 2, 1);

		expect(written[1].dependencies.map(String)).toEqual(['1']);
		expect(written[1]).not.toHaveProperty('metadata');
	});
});

describe('dependency provenance on subtasks', () => {
	beforeEach(() => writeJSON.mockClear());

	it('adding the dotted form of a stored sibling does not duplicate it and makes it explicit', async () => {
		const written = await run(addDependency, withSubtasks(), '2.3', '2.1');

		const subtask = written[0].subtasks[2];
		expect(subtask.dependencies).toEqual([1]);
		expect(subtask).not.toHaveProperty('metadata');
	});

	it('adds a new sibling explicit and keeps the dotted mark of the stored one', async () => {
		const written = await run(addDependency, withSubtasks(), '2.3', '2.2');

		const subtask = written[0].subtasks[2];
		expect(subtask.dependencies.map(String)).toEqual(['1', '2.2']);
		expect(subtask.metadata.dependencySources).toEqual({ 2.1: 'inferred' });
	});

	it('removing a sibling stored as a bare number prunes its dotted mark', async () => {
		const written = await run(removeDependency, withSubtasks(), '2.3', '2.1');

		expect(written[0].subtasks[2].dependencies).toEqual([]);
		expect(written[0].subtasks[2]).not.toHaveProperty('metadata');
	});
});

describe('subtask dependency on a task', () => {
	beforeEach(() => writeJSON.mockClear());

	const taskDependency = () => {
		const [parent] = withSubtasks();
		parent.subtasks[2].dependencies = ['1'];
		parent.subtasks[2].metadata = { dependencySources: { 1: 'inferred' } };
		return [
			{ id: 1, title: 'T1', status: 'pending', dependencies: [] },
			parent
		];
	};

	it('does not read the string "1" as sibling 2.1 when adding sibling 2.1', async () => {
		const written = await run(addDependency, taskDependency(), '2.3', '2.1');

		const subtask = written[1].subtasks[2];
		expect(subtask.dependencies).toEqual(['1', '2.1']);
		expect(subtask.metadata.dependencySources).toEqual({ 1: 'inferred' });
	});

	it('removing sibling 2.1 leaves the task dependency "1" and its mark', async () => {
		const tasks = taskDependency();
		tasks[1].subtasks[2].dependencies = ['1', 1];

		const written = await run(removeDependency, tasks, '2.3', '2.1');

		const subtask = written[1].subtasks[2];
		expect(subtask.dependencies).toEqual(['1']);
		expect(subtask.metadata.dependencySources).toEqual({ 1: 'inferred' });
	});
});

describe('fix-dependencies', () => {
	beforeEach(() => writeJSON.mockClear());

	it('prunes the mark of a dependency it removes', async () => {
		const broken = tasks();
		broken[2].dependencies = [1, 99];
		broken[2].metadata.dependencySources = { 1: 'inferred', 99: 'inferred' };
		readJSON.mockReturnValue({ tasks: structuredClone(broken) });

		await fixDependenciesCommand('tasks.json', { context });

		const written = writeJSON.mock.calls[0][1].tasks;
		expect(written[2].dependencies).toEqual([1]);
		expect(written[2].metadata.dependencySources).toEqual({ 1: 'inferred' });
	});
});
