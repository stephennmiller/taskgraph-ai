import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../common/errors/taskgraph-error.js';
import {
	applyChecklistChanges,
	buildChecklist,
	checkDoneGate,
	getUncheckedCriteria,
	normalizeAcceptanceCriteria,
	normalizeDefinitionOfDone,
	MAX_GENERATED_CRITERIA,
	MAX_GENERATED_CRITERION_LENGTH,
	parseChecklistNumbers,
	setGeneratedCriteria
} from './acceptance-criteria.js';

describe('normalizeAcceptanceCriteria', () => {
	it('reads legacy strings as unchecked criteria', () => {
		expect(
			normalizeAcceptanceCriteria(['Login works', 'Tokens expire'])
		).toEqual([
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
		acceptanceCriteria: [
			'Login works',
			{ text: 'Tokens expire', checked: true }
		],
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
			applyChecklistChanges({ acceptanceCriteria: ['Login works'] }, '3', [], {
				check: [4]
			})
		).toThrow("Task 3 has 1 criterion; there's no 4");
	});

	it('refuses to check a task with no checklist', () => {
		expect(() => applyChecklistChanges({}, '3', [], { check: [1] })).toThrow(
			'Task 3 has no criteria to check'
		);
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

describe('setGeneratedCriteria', () => {
	it('stores the strings an AI wrote as unchecked items', () => {
		const task = {
			id: 1,
			acceptanceCriteria: ['  Login works ', '', 'Tokens expire']
		};

		setGeneratedCriteria(task);

		expect(task.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false },
			{ text: 'Tokens expire', checked: false }
		]);
	});

	it('never stores a generated criterion as checked', () => {
		const task = {
			acceptanceCriteria: [{ text: 'Login works', checked: true }]
		};

		setGeneratedCriteria(task);

		expect(task.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false }
		]);
	});

	it.each([
		['missing', {}],
		['null', { acceptanceCriteria: null }],
		['empty', { acceptanceCriteria: [] }],
		['blank only', { acceptanceCriteria: ['  '] }]
	])('leaves the field off when the criteria are %s', (_label, fields) => {
		const task: Record<string, unknown> = { id: 1, ...fields };

		setGeneratedCriteria(task);

		expect(task).toEqual({ id: 1 });
	});
	it('strips escape sequences and control characters from AI text', () => {
		const task = {
			acceptanceCriteria: [
				'\x1b[31mRed\x1b[0m text',
				'Title \x1b]0;pwned\x07set',
				'Tab\tand\nnewline\u0000null',
				'Bidi \u202eesrever\u202c text',
				'\x1b[2J\u0007'
			]
		};

		setGeneratedCriteria(task);

		expect(task.acceptanceCriteria).toEqual([
			{ text: 'Red text', checked: false },
			{ text: 'Title set', checked: false },
			{ text: 'Tab and newline null', checked: false },
			{ text: 'Bidi esrever text', checked: false }
		]);
	});

	it('cuts a criterion longer than the cap', () => {
		const task: { acceptanceCriteria: unknown } = {
			acceptanceCriteria: ['x'.repeat(5000)]
		};

		setGeneratedCriteria(task);

		const [{ text }] = task.acceptanceCriteria as { text: string }[];
		expect(text).toHaveLength(MAX_GENERATED_CRITERION_LENGTH);
		expect(text.endsWith('…')).toBe(true);
	});

	it('keeps at most the capped number of criteria and drops duplicates', () => {
		const many = Array.from({ length: 50 }, (_, i) => `Criterion ${i}`);
		const task: { acceptanceCriteria: unknown } = {
			acceptanceCriteria: ['Criterion 0', ...many]
		};

		setGeneratedCriteria(task);

		const texts = (task.acceptanceCriteria as { text: string }[]).map(
			(c) => c.text
		);
		expect(texts).toHaveLength(MAX_GENERATED_CRITERIA);
		expect(texts[0]).toBe('Criterion 0');
		expect(texts[1]).toBe('Criterion 1');
	});

	it('builds plain items from entries carrying prototype keys', () => {
		const entry = JSON.parse(
			'{"text":"Login works","checked":true,"__proto__":{"polluted":true}}'
		);
		const task = JSON.parse(
			'{"acceptanceCriteria":[],"__proto__":{"polluted":true}}'
		);
		task.acceptanceCriteria = [entry];

		setGeneratedCriteria(task);

		expect(task.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false }
		]);
		expect(Object.keys(task.acceptanceCriteria[0])).toEqual([
			'text',
			'checked'
		]);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it.each([
		['a string', 'Login works'],
		['an object', { text: 'Login works' }],
		['numbers', [1, 2]]
	])('leaves the field off when the criteria are %s', (_label, raw) => {
		const task: Record<string, unknown> = { id: 1, acceptanceCriteria: raw };

		setGeneratedCriteria(task);

		expect(task).toEqual({ id: 1 });
	});
});
