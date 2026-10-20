/**
 * Recovering the task list when Claude Code repeats its JSON reply
 */
import {
	firstJsonObject,
	recoverTaskList
} from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const task = (id) => ({
	id,
	title: `Task ${id}`,
	description: 'Do it',
	details: 'Braces { and } and "quotes" inside a string',
	testStrategy: '',
	priority: 'high',
	dependencies: id > 1 ? [id - 1] : [],
	status: 'pending'
});
const reply = JSON.stringify({ tasks: [task(1), task(2)], metadata: null });

describe('firstJsonObject', () => {
	test('returns the first complete object when two are back to back', () => {
		expect(firstJsonObject(`${reply}${reply}`)).toBe(reply);
	});

	test('ignores braces and escaped quotes inside strings', () => {
		expect(firstJsonObject('x {"a":"}{\\"}"} y')).toBe('{"a":"}{\\"}"}');
	});

	test('returns null for incomplete or missing JSON', () => {
		expect(firstJsonObject('{"tasks": [')).toBeNull();
		expect(firstJsonObject('no json here')).toBeNull();
		expect(firstJsonObject(undefined)).toBeNull();
	});
});

describe('recoverTaskList', () => {
	test('recovers tasks from a repeated reply', () => {
		const result = recoverTaskList(`${reply}${reply}`);
		expect(result.tasks.map((t) => t.id)).toEqual([1, 2]);
	});

	test('rejects JSON that does not match the task schema', () => {
		expect(recoverTaskList('{"tasks": [{"id": 1}]}')).toBeNull();
		expect(recoverTaskList('{"other": true}{"other": true}')).toBeNull();
	});
});
