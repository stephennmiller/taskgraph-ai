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

	test('does not record a dependency that remapping dropped', () => {
		const tasks = processTasks([raw(1), raw(2, [9])], 1, [], 'medium');

		expect(tasks[1].dependencies).toEqual([]);
		expect(tasks[1].metadata).toBeUndefined();
	});
});
