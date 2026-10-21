/**
 * remove-task prunes the inferred marks of dependencies it removes;
 * remove-subtask --convert keeps the subtask's metadata. Only tasks.json I/O
 * is mocked.
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

import removeSubtask from '../../../../../scripts/modules/task-manager/remove-subtask.js';
import removeTask from '../../../../../scripts/modules/task-manager/remove-task.js';

const tagged = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'One', dependencies: [] },
			{ id: 2, title: 'Two', dependencies: [] },
			{
				id: 3,
				title: 'Three',
				dependencies: [1, 2],
				metadata: {
					jira: 'A-3',
					dependencySources: { 1: 'inferred', 2: 'inferred' }
				},
				subtasks: [
					{
						id: 1,
						title: 'S1',
						dependencies: [],
						metadata: { owner: 'kim', dependencySources: { 3.1: 'inferred' } }
					},
					{
						id: 2,
						title: 'S2',
						dependencies: [1, 2],
						metadata: {
							owner: 'kim',
							dependencySources: { 3.1: 'inferred', 3.2: 'inferred' }
						}
					}
				]
			}
		],
		metadata: {}
	}
});

beforeEach(() => {
	writeJSON.mockClear();
	readJSON.mockImplementation((path, projectRoot, tag) => {
		const data = tagged();
		return { ...data[tag], tag, _rawTaggedData: data };
	});
});

const written = () => writeJSON.mock.calls[0][1];

describe('remove-task dependency provenance', () => {
	test('prunes the mark of a dependency on the removed task', async () => {
		await removeTask('tasks.json', '1', { tag: 'master' });

		const dependent = written().master.tasks.find((t) => t.id === 3);
		expect(dependent.dependencies).toEqual([2]);
		expect(dependent.metadata).toEqual({
			jira: 'A-3',
			dependencySources: { 2: 'inferred' }
		});
	});

	test('a later dependency on a reused ID does not inherit the pruned mark', async () => {
		await removeTask('tasks.json', '2', { tag: 'master' });

		const dependent = written().master.tasks.find((t) => t.id === 3);
		expect(dependent.metadata.dependencySources).toEqual({ 1: 'inferred' });
	});
});

describe('remove-subtask --convert dependency provenance', () => {
	test('keeps the subtask metadata and re-keys its marks for top level', async () => {
		const converted = await removeSubtask('tasks.json', '3.2', true, false, {
			tag: 'master'
		});

		expect(converted.metadata.owner).toBe('kim');
		expect(converted.metadata.dependencySources).toEqual({
			1: 'inferred',
			2: 'inferred'
		});
	});
});
