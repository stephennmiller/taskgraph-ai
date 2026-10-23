import { describe, expect, it } from 'vitest';
import { mergeNewTaskDependencies } from './new-task-dependencies.js';

describe('mergeNewTaskDependencies', () => {
	const existingIds = [1, 2, 3];

	it('keeps the dependencies the user asked for when the AI suggests others (#271)', () => {
		const result = mergeNewTaskDependencies({
			explicit: [1],
			suggested: [2, 3],
			existingIds
		});

		expect(result.dependencies).toEqual([1, 2, 3]);
	});

	it('lists a dependency both asked for and suggested once', () => {
		const result = mergeNewTaskDependencies({
			explicit: [2, 1],
			suggested: [1, '2', 3, 3],
			existingIds
		});

		expect(result.dependencies).toEqual([2, 1, 3]);
	});

	it('stores the IDs a user typed as numbers and keeps a subtask dotted (#290)', () => {
		const result = mergeNewTaskDependencies({
			explicit: ['1', '3.2'],
			suggested: ['2', 1],
			existingIds: [1, 2, 3, '3.2']
		});

		expect(result.dependencies).toEqual([1, '3.2', 2]);
	});

	it('keeps only the dependencies the user asked for when the AI suggests none', () => {
		const result = mergeNewTaskDependencies({
			explicit: [3],
			suggested: null,
			existingIds
		});

		expect(result.dependencies).toEqual([3]);
	});

	it('sets aside IDs that are not in the given tasks, by who named them (#288)', () => {
		const result = mergeNewTaskDependencies({
			explicit: [1, 9],
			suggested: [2, 7],
			existingIds
		});

		expect(result).toEqual({
			dependencies: [1, 2],
			missingExplicit: [9],
			missingSuggested: [7]
		});
	});

	it('matches IDs stored as strings against numeric ones', () => {
		const result = mergeNewTaskDependencies({
			explicit: ['1'],
			suggested: [],
			existingIds: ['1', '2']
		});

		expect(result).toEqual({
			dependencies: [1],
			missingExplicit: [],
			missingSuggested: []
		});
	});
});
