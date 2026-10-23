import { describe, expect, it } from 'vitest';
import {
	DEPENDENCY_SOURCES_KEY,
	TASK_LINKS_KEY
} from './dependency-provenance.js';
import { dropReferences, removeAllSubtasks } from './removed-references.js';

type Item = {
	id: number;
	dependencies?: (string | number)[];
	metadata?: Record<string, unknown>;
	subtasks?: Item[];
};

const tasks = (): Item[] => [
	{ id: 1, dependencies: [] },
	{
		id: 5,
		dependencies: [],
		subtasks: [
			{ id: 1, dependencies: [] },
			{ id: 2, dependencies: [1] }
		]
	},
	{
		id: 3,
		dependencies: ['5.2', 1],
		metadata: {
			[DEPENDENCY_SOURCES_KEY]: { '5.2': 'inferred', '1': 'inferred' },
			[TASK_LINKS_KEY]: { '5.1': 'related', '1': 'discovered-from' }
		},
		subtasks: [
			{
				id: 1,
				dependencies: ['5.2', 2],
				metadata: { [DEPENDENCY_SOURCES_KEY]: { '5.2': 'inferred' } }
			},
			{ id: 2, dependencies: [] }
		]
	}
];

describe('dropReferences', () => {
	it('drops dependencies on the removed IDs from tasks and subtasks', () => {
		const list = tasks();

		dropReferences(list, ['5.2']);

		expect(list[2].dependencies).toEqual([1]);
		expect(list[2].subtasks?.[0].dependencies).toEqual([2]);
	});

	it('drops the provenance marks of the dropped dependencies', () => {
		const list = tasks();

		dropReferences(list, ['5.2']);

		expect(list[2].metadata?.[DEPENDENCY_SOURCES_KEY]).toEqual({
			'1': 'inferred'
		});
		expect(list[2].subtasks?.[0].metadata).toBeUndefined();
	});

	it('drops related and discovered-from links to the removed IDs', () => {
		const list = tasks();

		dropReferences(list, ['5.1']);

		expect(list[2].metadata?.[TASK_LINKS_KEY]).toEqual({
			'1': 'discovered-from'
		});
	});

	it('reads a bare number under a subtask as a sibling', () => {
		const list = tasks();

		// 3.1 depends on its sibling 2; task 2 isn't removed, subtask 3.2 is
		dropReferences(list, ['3.2']);

		expect(list[2].subtasks?.[0].dependencies).toEqual(['5.2']);
	});

	it('leaves everything as it is when nothing names the removed IDs', () => {
		const list = tasks();
		const before = JSON.parse(JSON.stringify(list));

		dropReferences(list, ['9.9']);

		expect(list).toEqual(before);
	});

	it("leaves an item's metadata alone when none of its dependencies go", () => {
		const list = tasks();
		const metadata = { [DEPENDENCY_SOURCES_KEY]: { '9': 'inferred' }, a: 1 };
		list[0].dependencies = [1];
		list[0].metadata = metadata;

		dropReferences(list, ['5.2']);

		expect(list[0].metadata).toBe(metadata);
	});
});

describe('removeAllSubtasks', () => {
	it('removes the subtasks and everything that named them', () => {
		const list = tasks();

		const count = removeAllSubtasks(list, list[1]);

		expect(count).toBe(2);
		expect(list[1].subtasks).toEqual([]);
		expect(list[2].dependencies).toEqual([1]);
		expect(list[2].subtasks?.[0].dependencies).toEqual([2]);
		expect(list[2].metadata?.[TASK_LINKS_KEY]).toEqual({
			'1': 'discovered-from'
		});
	});

	it('leaves the IDs free for new subtasks without old references', () => {
		const list = tasks();

		removeAllSubtasks(list, list[1]);
		list[1].subtasks?.push({ id: 2, dependencies: [] });

		expect(list[2].dependencies).not.toContain('5.2');
	});

	it('returns 0 for subtasks that are not a list', () => {
		const list = tasks();
		(list[0] as { subtasks?: unknown }).subtasks = {};

		expect(removeAllSubtasks(list, list[0])).toBe(0);
	});

	it('returns 0 for a task without subtasks', () => {
		const list = tasks();

		expect(removeAllSubtasks(list, list[0])).toBe(0);
		expect(list[0].subtasks).toBeUndefined();
	});
});
