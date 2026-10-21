/**
 * parse-prd marks every dependency it creates as AI-inferred
 */
import { processTasks } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const raw = (id, dependencies = []) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: '',
	testStrategy: '',
	priority: 'medium',
	dependencies,
	status: 'pending'
});

describe('processTasks dependency provenance', () => {
	test('records each AI-created dependency as inferred', () => {
		const tasks = processTasks(
			[raw(1), raw(2, [1]), raw(3, [1, 2])],
			1,
			[],
			'medium'
		);

		expect(tasks[0].metadata).toBeUndefined();
		expect(tasks[1].metadata.dependencySources).toEqual({ 1: 'inferred' });
		expect(tasks[2].metadata.dependencySources).toEqual({
			1: 'inferred',
			2: 'inferred'
		});
	});

	test('characterization: does not record a dependency that remapping dropped', () => {
		const tasks = processTasks([raw(1), raw(2, [9])], 1, [], 'medium');

		expect(tasks[1].dependencies).toEqual([]);
		expect(tasks[1].metadata).toBeUndefined();
	});
});

describe('processTasks with --append', () => {
	const existing = [{ id: 1 }, { id: 2 }, { id: 3 }];

	test('keeps a dependency on a task that already exists', () => {
		const tasks = processTasks(
			[raw(4, [2]), raw(5, [4, 3])],
			4,
			existing,
			'medium'
		);

		expect(tasks[0].dependencies).toEqual([2]);
		expect(tasks[0].metadata.dependencySources).toEqual({ 2: 'inferred' });
		expect(tasks[1].dependencies).toEqual([4, 3]);
	});

	test('still drops a dependency on a task that exists nowhere', () => {
		const tasks = processTasks([raw(4, [9])], 4, existing, 'medium');

		expect(tasks[0].dependencies).toEqual([]);
	});
});
