import { describe, expect, it } from 'vitest';
import { checkDependencies } from '../evals/plan-checks.js';
import {
	isForwardDependency,
	orderGeneratedSubtasks
} from './forward-dependencies.js';

const sub = (id: number, dependencies: Array<string | number> = []) => ({
	id,
	title: `Subtask ${id}`,
	dependencies
});

describe('isForwardDependency', () => {
	it('flags a later sibling, a later task and the parent itself', () => {
		expect(isForwardDependency('9.2', '9.4')).toBe(true);
		expect(isForwardDependency('3.3', '4')).toBe(true);
		expect(isForwardDependency('3.3', '3')).toBe(true);
		expect(isForwardDependency('3', '5.1')).toBe(true);
	});

	it('accepts an earlier sibling and a lower task or its subtask', () => {
		expect(isForwardDependency('9.4', '9.2')).toBe(false);
		expect(isForwardDependency('3.3', '2')).toBe(false);
		expect(isForwardDependency('30.1', '3.5')).toBe(false);
		expect(isForwardDependency('3', '2.1')).toBe(false);
	});
});

describe('orderGeneratedSubtasks', () => {
	it('moves a subtask after the later sibling it depends on and renumbers', () => {
		// 9.2 and 9.3 wait on 9.4, as in the link-shortener eval
		const result = orderGeneratedSubtasks({ id: '9' }, [
			sub(1),
			sub(2, [1, 4]),
			sub(3, ['9.4']),
			sub(4, [1])
		]);

		expect(result.map((s) => [s.title, s.id, s.dependencies])).toEqual([
			['Subtask 1', 1, []],
			['Subtask 4', 2, [1]],
			['Subtask 2', 3, [1, 2]],
			['Subtask 3', 4, ['9.2']]
		]);
		expect(checkDependencies([{ id: '9', subtasks: result }]).invalid).toEqual(
			[]
		);
	});

	it('drops a dependency on a later task the parent does not depend on', () => {
		const log: string[] = [];
		const result = orderGeneratedSubtasks(
			{ id: '3', dependencies: ['1', '5'] },
			[sub(1, ['2', '4', '5', '5.2', '4.1'])],
			(message) => log.push(message)
		);

		expect(result[0].dependencies).toEqual(['2', '5', '5.2']);
		expect(log).toEqual([
			"Dropped dependency 4 of subtask 3.1: task 3 doesn't depend on it",
			"Dropped dependency 4.1 of subtask 3.1: task 3 doesn't depend on it"
		]);
	});

	it('breaks a loop between siblings without adding one', () => {
		const log: string[] = [];
		const result = orderGeneratedSubtasks(
			{ id: '2' },
			[sub(1, [2]), sub(2, [1]), sub(3, [2])],
			(message) => log.push(message)
		);

		expect(result.map((s) => [s.title, s.id, s.dependencies])).toEqual([
			['Subtask 1', 1, []],
			['Subtask 2', 2, [1]],
			['Subtask 3', 3, [2]]
		]);
		expect(log).toEqual([
			'Dropped dependency 2.2 of subtask 2.1: it made a loop'
		]);
	});

	it('keeps a dependency that only leads into a loop', () => {
		const log: string[] = [];
		const result = orderGeneratedSubtasks(
			{ id: '2' },
			[sub(1, [2]), sub(2, [3]), sub(3, [2])],
			(message) => log.push(message)
		);

		expect(result.map((s) => [s.title, s.id, s.dependencies])).toEqual([
			['Subtask 2', 1, []],
			['Subtask 1', 2, [1]],
			['Subtask 3', 3, [1]]
		]);
		expect(log).toEqual([
			'Dropped dependency 2.3 of subtask 2.2: it made a loop'
		]);
	});

	it('keeps existing subtask IDs when appending', () => {
		// Task 4 has subtasks 1-2; expand appended 3-4, and 3 waits on 4
		const result = orderGeneratedSubtasks({ id: '4' }, [
			sub(3, [4, 2]),
			sub(4, ['4.1'])
		]);

		expect(result.map((s) => [s.title, s.id, s.dependencies])).toEqual([
			['Subtask 4', 3, ['4.1']],
			['Subtask 3', 4, [3, 2]]
		]);
	});

	it('leaves subtasks without forward dependencies as they are', () => {
		const subtasks = [sub(5, ['1']), sub(6, [5, '2.3']), sub(7, [6, 3])];
		const result = orderGeneratedSubtasks({ id: '2' }, subtasks);

		expect(result).toEqual(subtasks);
	});

	it('keeps the order when IDs repeat', () => {
		const result = orderGeneratedSubtasks({ id: '4' }, [
			sub(1, [2]),
			sub(1),
			sub(2, ['9'])
		]);

		expect(result.map((s) => [s.id, s.dependencies])).toEqual([
			[1, [2]],
			[1, []],
			[2, []]
		]);
	});
});
