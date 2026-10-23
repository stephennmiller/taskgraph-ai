import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import {
	applyChecklistChanges,
	buildChecklist,
	checkDoneGate,
	getUncheckedCriteria,
	keepChecklistFields,
	normalizeAcceptanceCriteria,
	normalizeDefinitionOfDone,
	parseChecklistNumbers
} from './acceptance-criteria.js';

describe('normalizeAcceptanceCriteria', () => {
	it('reads legacy strings as unchecked criteria', () => {
		expect(normalizeAcceptanceCriteria(['Login works', 'Tokens expire'])).toEqual([
			{ text: 'Login works', checked: false },
			{ text: 'Tokens expire', checked: false }
		]);
	});

	it('reads a mix of strings and checked items', () => {
		expect(
			normalizeAcceptanceCriteria([
				'Login works',
				{ text: 'Tokens expire', checked: true }
			])
		).toEqual([
			{ text: 'Login works', checked: false },
			{ text: 'Tokens expire', checked: true }
		]);
	});

	it('drops blank and malformed entries', () => {
		expect(
			normalizeAcceptanceCriteria(['  ', 7, null, { checked: true }, 'Ok'])
		).toEqual([{ text: 'Ok', checked: false }]);
	});

	it('returns nothing for a missing field', () => {
		expect(normalizeAcceptanceCriteria(undefined)).toEqual([]);
	});
});

describe('normalizeDefinitionOfDone', () => {
	it('keeps non-blank strings once each', () => {
		expect(
			normalizeDefinitionOfDone([' Tests pass ', '', 3, 'Tests pass', 'Docs'])
		).toEqual(['Tests pass', 'Docs']);
	});

	it('ignores a value that is not a list', () => {
		expect(normalizeDefinitionOfDone('Tests pass')).toEqual([]);
	});
});

describe('buildChecklist', () => {
	const task = {
		acceptanceCriteria: ['Login works', { text: 'Tokens expire', checked: true }],
		definitionOfDoneChecked: ['Docs updated']
	};

	it('numbers task criteria first, then the Definition of Done', () => {
		const checklist = buildChecklist(task, ['Tests pass', 'Docs updated']);

		expect(checklist.items).toEqual([
			{ number: 1, text: 'Login works', checked: false, source: 'task' },
			{ number: 2, text: 'Tokens expire', checked: true, source: 'task' },
			{
				number: 3,
				text: 'Tests pass',
				checked: false,
				source: 'definition-of-done'
			},
			{
				number: 4,
				text: 'Docs updated',
				checked: true,
				source: 'definition-of-done'
			}
		]);
		expect(checklist.checkedCount).toBe(2);
		expect(checklist.unchecked.map((i) => i.number)).toEqual([1, 3]);
	});

	it('leaves the Definition of Done off a subtask', () => {
		const checklist = buildChecklist(task, ['Tests pass'], true);

		expect(checklist.items.map((i) => i.text)).toEqual([
			'Login works',
			'Tokens expire'
		]);
	});
});

describe('applyChecklistChanges', () => {
	it('checks a criterion and stores every criterion as an item', () => {
		const fields = applyChecklistChanges(
			{ acceptanceCriteria: ['Login works', 'Tokens expire'] },
			'3',
			[],
			{ check: [2] }
		);

		expect(fields).toEqual({
			acceptanceCriteria: [
				{ text: 'Login works', checked: false },
				{ text: 'Tokens expire', checked: true }
			]
		});
	});

	it('checks Definition of Done items by their number after the criteria', () => {
		const fields = applyChecklistChanges(
			{ acceptanceCriteria: ['Login works'] },
			'3',
			['Tests pass', 'Docs updated'],
			{ check: [3] }
		);

		expect(fields.definitionOfDoneChecked).toEqual(['Docs updated']);
	});

	it('unchecks an item', () => {
		const fields = applyChecklistChanges(
			{ acceptanceCriteria: [{ text: 'Login works', checked: true }] },
			'3',
			[],
			{ uncheck: [1] }
		);

		expect(fields.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false }
		]);
	});

	it('refuses a number past the end of the checklist', () => {
		expect(() =>
			applyChecklistChanges(
				{ acceptanceCriteria: ['Login works'] },
				'3',
				[],
				{ check: [4] }
			)
		).toThrow("Task 3 has 1 criterion; there's no 4");
	});

	it('refuses to check a task with no checklist', () => {
		expect(() =>
			applyChecklistChanges({}, '3', [], { check: [1] })
		).toThrow('Task 3 has no criteria to check');
	});
});

describe('checkDoneGate', () => {
	it('lets a task with no criteria and no Definition of Done through', () => {
		expect(checkDoneGate({}, '3', [])).toBeUndefined();
	});

	it('lets a task with every item checked through', () => {
		expect(
			checkDoneGate(
				{
					acceptanceCriteria: [{ text: 'Login works', checked: true }],
					definitionOfDoneChecked: ['Tests pass']
				},
				'3',
				['Tests pass']
			)
		).toBeUndefined();
	});

	it('refuses while items are unchecked and lists them', () => {
		const error = checkDoneGate(
			{ acceptanceCriteria: ['Login works', { text: 'Ok', checked: true }] },
			'3',
			['Tests pass']
		);

		expect(error?.code).toBe(ERROR_CODES.CRITERIA_UNCHECKED);
		expect(error?.message).toBe('2 criteria unchecked on task 3');
		expect(getUncheckedCriteria(error)?.unchecked.map((i) => i.number)).toEqual(
			[1, 3]
		);
	});

	it('says criterion for one unchecked item on a subtask', () => {
		const error = checkDoneGate(
			{ acceptanceCriteria: ['Login works'] },
			'3.1',
			['Tests pass'],
			true
		);

		expect(error?.message).toBe('1 criterion unchecked on subtask 3.1');
	});
});

describe('getUncheckedCriteria', () => {
	it('returns nothing for other errors', () => {
		expect(getUncheckedCriteria(new Error('boom'))).toBeUndefined();
	});
});

describe('parseChecklistNumbers', () => {
	it('reads comma lists and repeated values', () => {
		expect(parseChecklistNumbers(['2,4', ' 5 '])).toEqual([2, 4, 5]);
	});

	it('names a value that is not a number', () => {
		expect(() => parseChecklistNumbers('2,x')).toThrow(
			`"x" isn't a criterion number`
		);
	});

	it('refuses zero', () => {
		expect(() => parseChecklistNumbers('0')).toThrow(
			`"0" isn't a criterion number`
		);
	});
});

describe('keepChecklistFields', () => {
	it('copies stored criteria and checked Definition of Done items onto a rewrite', () => {
		const stored = {
			acceptanceCriteria: [{ text: 'Login works', checked: true }],
			definitionOfDoneChecked: ['Tests pass']
		};
		const rewrite: Record<string, unknown> = { id: 1, title: 'New' };

		keepChecklistFields(rewrite, stored);

		expect(rewrite).toEqual({ id: 1, title: 'New', ...stored });
	});

	it('leaves the rewrite alone when nothing was stored', () => {
		const rewrite = { id: 1, title: 'New' };

		keepChecklistFields(rewrite, undefined);
		keepChecklistFields(rewrite, {});

		expect(rewrite).toEqual({ id: 1, title: 'New' });
	});
});
