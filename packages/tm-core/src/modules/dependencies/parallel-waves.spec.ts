import { describe, expect, it } from 'vitest';
import type { Subtask, Task } from '../../common/types/index.js';
import { createSubtask } from '../../testing/task-fixtures.js';
import { parallelWaves } from './parallel-waves.js';

const task = (
	id: string,
	dependencies: string[] = [],
	status: Task['status'] = 'pending',
	subtasks: Task['subtasks'] = []
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
		subtasks
	}) as Task;

const sub = (id: number, status: Task['status'] = 'pending'): Subtask =>
	createSubtask({ id, title: `Subtask ${id}`, status, dependencies: [] });

describe('parallelWaves', () => {
	it('puts each link of a chain in its own wave', () => {
		const result = parallelWaves([
			task('1'),
			task('2', ['1']),
			task('3', ['2'])
		]);

		expect(result.waves).toEqual([['1'], ['2'], ['3']]);
		expect(result.waveOf).toEqual({ '1': 1, '2': 2, '3': 3 });
		expect(result.unscheduled).toEqual([]);
	});

	it('runs both sides of a diamond together and joins after the later one', () => {
		const result = parallelWaves([
			task('1'),
			task('2', ['1']),
			task('3', ['1']),
			task('4', ['2', '3']),
			task('5', ['2', '4'])
		]);

		expect(result.waves).toEqual([['1'], ['2', '3'], ['4'], ['5']]);
	});

	it('puts independent tasks in wave 1, in ID order', () => {
		const result = parallelWaves([task('10'), task('2'), task('1')]);

		expect(result.waves).toEqual([['1', '2', '10']]);
	});

	it('leaves finished tasks out and counts them as satisfied', () => {
		const result = parallelWaves([
			task('1', [], 'done'),
			task('2', ['1']),
			task('3', ['1'], 'cancelled'),
			task('4', ['3'], 'in-progress'),
			task('5', ['2', '4'], 'completed')
		]);

		expect(result.waves).toEqual([['2', '4']]);
		expect(result.waveOf).toEqual({ '2': 1, '4': 1 });
	});

	it('is empty when everything is done', () => {
		const result = parallelWaves([
			task('1', [], 'done'),
			task('2', ['1'], 'done')
		]);

		expect(result).toEqual({ waves: [], waveOf: {}, unscheduled: [] });
	});

	it('reports loop members and the tasks behind a loop without a wave', () => {
		const result = parallelWaves([
			task('1'),
			task('2', ['3', '1']),
			task('3', ['2']),
			task('4', ['3']),
			task('5', ['4']),
			task('6', ['6'])
		]);

		expect(result.waves).toEqual([['1']]);
		expect(result.unscheduled).toEqual([
			{ id: '2', reason: 'cycle', blockers: ['3'] },
			{ id: '3', reason: 'cycle', blockers: ['2'] },
			{ id: '4', reason: 'waiting', blockers: ['3'] },
			{ id: '5', reason: 'waiting', blockers: ['4'] },
			{ id: '6', reason: 'cycle', blockers: ['6'] }
		]);
	});

	it('ignores a loop that runs through a finished task', () => {
		const result = parallelWaves([task('1', ['2'], 'done'), task('2', ['1'])]);

		expect(result.waves).toEqual([['2']]);
	});

	it('gives no wave to a task with a missing dependency, or to what waits on it', () => {
		const result = parallelWaves([
			task('1', ['99']),
			task('2', ['1']),
			task('3', ['4.9'])
		]);

		expect(result.waves).toEqual([]);
		expect(result.unscheduled).toEqual([
			{ id: '1', reason: 'missing', blockers: ['99'] },
			{ id: '2', reason: 'waiting', blockers: ['1'] },
			{ id: '3', reason: 'missing', blockers: ['4.9'] }
		]);
	});

	it('holds review, blocked and deferred tasks and what depends on them', () => {
		const result = parallelWaves([
			task('1', [], 'review'),
			task('2', [], 'blocked'),
			task('3', [], 'deferred'),
			task('4', ['1']),
			task('5')
		]);

		expect(result.waves).toEqual([['5']]);
		expect(result.unscheduled.map((u) => [u.id, u.reason])).toEqual([
			['1', 'held'],
			['2', 'held'],
			['3', 'held'],
			['4', 'waiting']
		]);
	});

	it('orders a task after the parent of an unfinished subtask it needs', () => {
		const result = parallelWaves([
			task('1', [], 'in-progress', [sub(1, 'done'), sub(2)]),
			task('2', ['1.1']),
			task('3', ['1.2']),
			task('4', ['4.1'], 'pending', [sub(1)])
		]);

		expect(result.waveOf).toEqual({ '1': 1, '2': 1, '3': 2, '4': 1 });
	});

	it('reads numeric IDs and dependencies as tasks.json stores them', () => {
		const result = parallelWaves([
			{ ...task('1', [], 'pending', [sub(1)]), id: 1 },
			{ ...task('2'), id: 2, dependencies: [1] },
			{ ...task('3'), id: 3, dependencies: ['1.1', 2] }
		] as unknown as Task[]);

		expect(result.waveOf).toEqual({ '1': 1, '2': 2, '3': 3 });
	});

	it('reports a loop that runs through a subtask', () => {
		const result = parallelWaves([
			task('1', ['2'], 'pending', [sub(1)]),
			task('2', ['1.1'])
		]);

		expect(result.waves).toEqual([]);
		expect(result.unscheduled.map((u) => [u.id, u.reason])).toEqual([
			['1', 'cycle'],
			['2', 'cycle']
		]);
	});

	it('treats IDs that name Object properties as plain IDs', () => {
		const result = parallelWaves([
			task('constructor'),
			task('__proto__', ['constructor']),
			task('toString', ['__proto__'])
		]);

		expect(result.waves).toEqual([
			['constructor'],
			['__proto__'],
			['toString']
		]);
		expect(result.waveOf.toString).toBe(3);
		expect(JSON.parse(JSON.stringify(result.waveOf))).toEqual({
			constructor: 1,
			['__proto__']: 2,
			toString: 3
		});
	});

	it('schedules a 10k wide fan-out and fan-in quickly', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
		const wide = [
			task('0'),
			...ids.map((id) => task(id, ['0'])),
			task('end', ids)
		];
		const started = performance.now();

		const result = parallelWaves(wide);

		expect(result.waves.map((w) => w.length)).toEqual([1, 10_000, 1]);
		// Generous bound: linear work, but CI runners can be busy
		expect(performance.now() - started).toBeLessThan(5000);
	});

	it('handles a long chain without overflowing the stack', () => {
		const tasks = Array.from({ length: 20000 }, (_, i) =>
			task(String(i + 1), i ? [String(i)] : [])
		);

		const result = parallelWaves(tasks);

		expect(result.waves).toHaveLength(20000);
		expect(result.waveOf['20000']).toBe(20000);
	});
});
