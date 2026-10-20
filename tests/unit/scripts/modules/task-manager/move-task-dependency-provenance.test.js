/**
 * Moving a task to a new ID keeps the inferred mark on tasks that depend on it
 */
import { vi } from 'vitest';

vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	setTasksForTag: vi.fn(),
	traverseDependencies: vi.fn(() => [])
}));

vi.doMock(
	'../../../../../scripts/modules/task-manager/is-task-dependent.js',
	() => ({
		default: vi.fn(() => false)
	})
);

vi.doMock('../../../../../scripts/modules/dependency-manager.js', () => ({
	findCrossTagDependencies: vi.fn(() => []),
	getDependentTaskIds: vi.fn(() => []),
	validateSubtaskMove: vi.fn()
}));

const { readJSON, writeJSON } = await import(
	'../../../../../scripts/modules/utils.js'
);
const { default: moveTask } = await import(
	'../../../../../scripts/modules/task-manager/move-task.js'
);

const tagged = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'A', dependencies: [] },
			{
				id: 2,
				title: 'B',
				dependencies: [1],
				metadata: { dependencySources: { 1: 'inferred' } },
				subtasks: [
					{
						id: 1,
						title: 'B.1',
						dependencies: [1],
						metadata: { dependencySources: { 1: 'inferred' } }
					}
				]
			}
		],
		metadata: {}
	}
});

describe('moveTask dependency provenance', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readJSON.mockImplementation((path, projectRoot, tag) => {
			const data = tagged();
			return { ...data[tag], tag, _rawTaggedData: data };
		});
	});

	test('carries the inferred mark to the new ID of a dependency', async () => {
		await moveTask('tasks.json', '1', '3', false, { tag: 'master' });

		const written = writeJSON.mock.calls[0][1].master.tasks;
		const dependent = written.find((t) => t.id === 2);
		expect(dependent.dependencies).toEqual([3]);
		expect(dependent.metadata.dependencySources).toEqual({ 3: 'inferred' });
		expect(dependent.subtasks[0].dependencies).toEqual([3]);
		expect(dependent.subtasks[0].metadata.dependencySources).toEqual({
			3: 'inferred'
		});
	});
});
