import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_SOURCES_KEY,
	getDependencySource
} from './dependency-provenance.js';
import {
	dependenciesForConvertedTask,
	dependenciesForMovedItem,
	retargetDependents
} from './task-to-subtask.js';

const marks = (value: Record<string, string>) => ({
	[DEPENDENCY_SOURCES_KEY]: value
});

describe('dependenciesForConvertedTask', () => {
	it('rewrites numeric task dependencies as task strings, not sibling numbers', () => {
		const { dependencies } = dependenciesForConvertedTask(
			{ dependencies: [2, 3] },
			5
		);

		expect(dependencies).toEqual(['2', '3']);
	});

	it('keeps string and dotted dependencies as they are', () => {
		const { dependencies } = dependenciesForConvertedTask(
			{ dependencies: ['2', '4.1'] },
			5
		);

		expect(dependencies).toEqual(['2', '4.1']);
	});

	it('drops a dependency on the new parent', () => {
		const { dependencies } = dependenciesForConvertedTask(
			{ dependencies: [5, '5', 2] },
			5
		);

		expect(dependencies).toEqual(['2']);
	});

	it('drops repeats left by the rewrite', () => {
		const { dependencies } = dependenciesForConvertedTask(
			{ dependencies: [2, '2'] },
			5
		);

		expect(dependencies).toEqual(['2']);
	});

	it('moves inferred marks to the rewritten dependencies and drops those of removed ones', () => {
		const { dependencies, metadata } = dependenciesForConvertedTask(
			{
				dependencies: [2, 5, 3],
				metadata: {
					jira: 'A-1',
					...marks({ '2': 'inferred', '5': 'inferred' })
				}
			},
			5
		);

		expect(dependencies).toEqual(['2', '3']);
		expect(metadata).toEqual({ jira: 'A-1', ...marks({ '2': 'inferred' }) });
		expect(getDependencySource({ dependencies, metadata }, '2', 5)).toBe(
			'inferred'
		);
		expect(getDependencySource({ dependencies, metadata }, '3', 5)).toBe(
			'explicit'
		);
	});

	it('keeps the marks of dotted dependencies', () => {
		const { metadata } = dependenciesForConvertedTask(
			{ dependencies: ['4.1'], metadata: marks({ '4.1': 'inferred' }) },
			5
		);

		expect(metadata).toEqual(marks({ '4.1': 'inferred' }));
	});

	it('returns no metadata when the task had none', () => {
		expect(
			dependenciesForConvertedTask({ dependencies: [2] }, 5).metadata
		).toBeUndefined();
	});

	it('handles a task with no dependencies', () => {
		expect(dependenciesForConvertedTask({}, 5)).toEqual({
			dependencies: [],
			metadata: undefined
		});
	});
});

describe('dependenciesForMovedItem', () => {
	it('writes the siblings of a subtask that becomes a task as full IDs', () => {
		const { dependencies } = dependenciesForMovedItem(
			{ dependencies: [1, '3', '4.2', 150] },
			5,
			undefined
		);

		expect(dependencies).toEqual(['5.1', '3', '4.2', '150']);
	});

	it('keeps a dependency of a subtask on its old parent when it becomes a task', () => {
		const { dependencies } = dependenciesForMovedItem(
			{ dependencies: ['5', 2] },
			5,
			undefined
		);

		expect(dependencies).toEqual(['5', '5.2']);
	});

	it('keeps the siblings of a subtask that moves to another parent pointing at the old ones', () => {
		const { dependencies } = dependenciesForMovedItem(
			{ dependencies: [1, '8.2'] },
			5,
			8
		);

		expect(dependencies).toEqual(['5.1', '8.2']);
	});

	it('drops a dependency on the new parent', () => {
		const { dependencies } = dependenciesForMovedItem(
			{ dependencies: ['8', 1] },
			5,
			8
		);

		expect(dependencies).toEqual(['5.1']);
	});

	it('re-keys the marks of siblings to the full IDs they now name', () => {
		const { dependencies, metadata } = dependenciesForMovedItem(
			{
				dependencies: [1, 2],
				metadata: marks({ '5.1': 'inferred' })
			},
			5,
			undefined
		);

		expect(dependencies).toEqual(['5.1', '5.2']);
		expect(metadata).toEqual(marks({ '5.1': 'inferred' }));
		expect(getDependencySource({ dependencies, metadata }, '5.1')).toBe(
			'inferred'
		);
		expect(getDependencySource({ dependencies, metadata }, '5.2')).toBe(
			'explicit'
		);
	});
});

describe('retargetDependents', () => {
	const tasks = (): Parameters<typeof retargetDependents>[0] => [
		{ id: 1, dependencies: [] },
		{
			id: 2,
			dependencies: [1, '1', '3.1'],
			metadata: marks({ '1': 'inferred' }),
			subtasks: [
				// 1 is sibling 2.1; "1" is task 1
				{
					id: 1,
					dependencies: ['1', 1],
					metadata: marks({ '1': 'inferred', '2.1': 'inferred' })
				},
				{ id: 2, dependencies: [1] }
			]
		},
		{ id: 3, dependencies: [], subtasks: [{ id: 1, dependencies: [] }] }
	];

	it('points task references at the new ID and leaves sibling numbers alone', () => {
		const list = tasks();

		retargetDependents(list, '1', '9.4');

		expect(list[1].dependencies).toEqual(['9.4', '9.4', '3.1']);
		expect(list[1].subtasks?.[0].dependencies).toEqual(['9.4', 1]);
		expect(list[1].subtasks?.[1].dependencies).toEqual([1]);
	});

	it('moves the mark of a reference along with it', () => {
		const list = tasks();

		retargetDependents(list, '1', '9.4');

		expect(list[1].metadata).toEqual(marks({ '9.4': 'inferred' }));
		expect(list[1].subtasks?.[0].metadata).toEqual(
			marks({ '9.4': 'inferred', '2.1': 'inferred' })
		);
	});

	it('finds references to a subtask by their sibling numbers too', () => {
		const list = tasks();

		retargetDependents(list, '2.1', 7);

		expect(list[1].subtasks?.[1].dependencies).toEqual(['7']);
		expect(list[1].subtasks?.[0].dependencies).toEqual(['1', '7']);
	});

	it('keeps the form of a top-level reference', () => {
		const list = tasks();

		retargetDependents(list, '1', 4);

		expect(list[1].dependencies).toEqual([4, 4, '3.1']);
		expect(list[1].subtasks?.[0].dependencies).toEqual(['4', 1]);
	});
});
