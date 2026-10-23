/**
 * Fuzzy search matches a task by its dependencies' titles whether it stores
 * them as 3 or "3" (#290: top-level dependencies are stored as strings).
 */

import { FuzzyTaskSearch } from '../../../../../scripts/modules/utils/fuzzyTaskSearch.js';

describe('FuzzyTaskSearch dependency titles', () => {
	it('names dependencies stored as strings on tasks with numeric IDs', () => {
		const tasks = [
			{ id: 1, title: 'Set up database', dependencies: [] },
			{ id: 2, title: 'Add login', dependencies: ['1'] }
		];

		const search = new FuzzyTaskSearch(tasks);

		expect(search.searchableTasks[1].dependencyTitles).toBe('Set up database');
	});
});
