import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { analyzeDependencies } from './dependency-analysis.js';

const task = (
	id: string,
	dependencies: string[] = [],
	status: Task['status'] = 'pending'
): Task =>
	({
		id,
		title: `Task ${id}`,
		description: '',
		status,
		priority: 'medium',
		dependencies,
		details: '',
		testStrategy: '',
		subtasks: []
	}) as Task;

describe('analyzeDependencies', () => {
	it('reports bottlenecks, the critical path and cycles', () => {
		const analysis = analyzeDependencies([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['5']),
			task('5', ['4'])
		]);

		expect(analysis.bottlenecks.map((b) => [b.id, b.blocks])).toEqual([
			['1', 2],
			['2', 1],
			['4', 1],
			['5', 1]
		]);
		expect(analysis.criticalPath).toEqual(['1', '2', '3']);
		expect(analysis.cycles).toEqual([['4', '5']]);
	});

	it('limits the bottleneck list', () => {
		const tasks = [task('1')];
		for (let i = 2; i <= 6; i++) tasks.push(task(String(i), [String(i - 1)]));

		expect(analyzeDependencies(tasks, { limit: 2 }).bottlenecks).toHaveLength(
			2
		);
	});

	it('keeps five bottlenecks unless told otherwise', () => {
		const tasks = [task('1')];
		for (let i = 2; i <= 9; i++) tasks.push(task(String(i), [String(i - 1)]));

		expect(analyzeDependencies(tasks).bottlenecks).toHaveLength(5);
		expect(analyzeDependencies(tasks, { limit: 8 }).bottlenecks).toHaveLength(
			8
		);
	});

	it('explains the blockers of one task next to the analysis', () => {
		const analysis = analyzeDependencies(
			[task('1'), task('2', ['1']), task('3', ['2'])],
			{ id: '3' }
		);

		expect(analysis.explanation?.id).toBe('3');
		expect(analysis.explanation?.blocked).toBe(true);
		expect(analysis.criticalPath).toEqual(['1', '2', '3']);
	});

	it('leaves the explanation out without an id, and throws for an unknown one', () => {
		expect(analyzeDependencies([task('1')]).explanation).toBeUndefined();
		expect(() => analyzeDependencies([task('1')], { id: '9' })).toThrow();
	});

	it('is empty when everything is finished', () => {
		expect(
			analyzeDependencies([task('1', [], 'done'), task('2', ['1'], 'done')])
		).toEqual({ bottlenecks: [], criticalPath: [], cycles: [] });
	});
});
