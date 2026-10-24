/**
 * @fileoverview Turning the model's parse-prd reply into stored tasks
 */

import { describe, expect, it } from 'vitest';
import { hashPrdSection } from '../../prd/prd-deltas.js';
import { parsePrdSections } from '../../prd/prd-sections.js';
import {
	firstJsonObject,
	prepareGeneratedTasks,
	recoverTaskList
} from './prd-tasks.js';

const raw = (id: number, extra: Record<string, unknown> = {}) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: 'Braces { and } and "quotes" inside a string',
	testStrategy: '',
	priority: 'high',
	dependencies: [] as number[],
	status: 'pending',
	...extra
});

const prepare = (
	tasks: ReturnType<typeof raw>[],
	options: Partial<Parameters<typeof prepareGeneratedTasks>[1]> = {}
) =>
	prepareGeneratedTasks(tasks, {
		startId: 1,
		existingIds: [],
		defaultPriority: 'medium',
		...options
	});

describe('recovering a reply that repeats its JSON', () => {
	const reply = JSON.stringify({
		tasks: [raw(1), raw(2, { dependencies: [1] })],
		metadata: null
	});

	it('finds the first complete object of two back to back', () => {
		expect(firstJsonObject(`${reply}${reply}`)).toBe(reply);
	});

	it('ignores braces and escaped quotes inside strings', () => {
		expect(firstJsonObject('x {"a":"}{\\"}"} y')).toBe('{"a":"}{\\"}"}');
	});

	it('returns null for incomplete or missing JSON', () => {
		expect(firstJsonObject('{"tasks": [')).toBeNull();
		expect(firstJsonObject('no json here')).toBeNull();
		expect(firstJsonObject(undefined)).toBeNull();
	});

	it('recovers the tasks, and nothing that misses the schema', () => {
		expect(recoverTaskList(`${reply}${reply}`)?.tasks.map((t) => t.id)).toEqual(
			[1, 2]
		);
		expect(recoverTaskList('{"tasks": [{"id": 1}]}')).toBeNull();
		expect(recoverTaskList('{"other": true}{"other": true}')).toBeNull();
	});
});

describe('prepareGeneratedTasks', () => {
	const prd = {
		path: 'docs/prd.md',
		sections: parsePrdSections('# App\n\n## Authentication\n\n## Search\n')
	};

	it('stores a known section as metadata.source, next to dependency provenance', () => {
		const tasks = prepare(
			[
				raw(1, { section: 'authentication' }),
				raw(2, { section: 'Search', dependencies: [1] }),
				raw(3, { section: 'billing' })
			],
			{ prd }
		);
		expect(tasks[0].metadata).toEqual({
			source: 'docs/prd.md#authentication',
			// The section's hash, so a later append can tell it changed (#203)
			sourceHash: hashPrdSection('## Authentication')
		});
		expect(tasks[1].metadata).toEqual({
			source: 'docs/prd.md#search',
			sourceHash: hashPrdSection('## Search'),
			dependencySources: { 1: 'inferred' }
		});
		// A section the PRD doesn't have points nowhere
		expect(tasks[2].metadata).toBeUndefined();
		for (const task of tasks) expect(task).not.toHaveProperty('section');
	});

	it('records each AI-made dependency as inferred, and none it had to drop', () => {
		const tasks = prepare([
			raw(1),
			raw(2, { dependencies: [1] }),
			raw(3, { dependencies: [1, 2, 9] })
		]);
		expect(tasks[0].metadata).toBeUndefined();
		expect(tasks[2].dependencies).toEqual([1, 2]);
		expect(tasks[2].metadata.dependencySources).toEqual({
			1: 'inferred',
			2: 'inferred'
		});
	});

	it('keeps a dependency on an existing task when the model numbered from the prompt', () => {
		const [task] = prepare([raw(5, { dependencies: [2] })], {
			startId: 5,
			promptStartId: 5,
			existingIds: ['1', '2']
		});
		expect(task).toMatchObject({ id: 5, dependencies: [2] });
	});

	it('stores the criteria as unchecked items, cleaned, and no field for none', () => {
		const tasks = prepare([
			raw(1, {
				acceptanceCriteria: [
					'\x1b[31mLogin\x1b[0m works\n',
					'  Wrong passwords are rejected  ',
					'',
					42,
					null
				]
			}),
			raw(2, { acceptanceCriteria: null }),
			raw(3, { acceptanceCriteria: 'Login works' }),
			raw(4, { acceptanceCriteria: { text: 'Login works' } })
		]);
		expect(tasks[0].acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false },
			{ text: 'Wrong passwords are rejected', checked: false }
		]);
		for (const task of tasks.slice(1)) {
			expect(task).not.toHaveProperty('acceptanceCriteria');
		}
	});

	it('fills in the defaults the model left out', () => {
		const [task] = prepare([
			{ ...raw(1), priority: '', status: '', details: undefined } as any
		]);
		expect(task).toMatchObject({
			priority: 'medium',
			status: 'pending',
			details: '',
			subtasks: []
		});
	});

	it.each([
		['not positive integers', [0, 1]],
		['repeated', [1, 1]],
		['starting elsewhere', [3, 4]],
		['with a gap', [1, 3]]
	])('refuses model IDs %s', (_name, ids) => {
		expect(() => prepare(ids.map((id) => raw(id)))).toThrow(
			/PRD tasks? (must|IDs)/
		);
	});
});
