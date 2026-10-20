import { describe, expect, it } from 'vitest';
import type { Subtask, Task } from '../../common/types/index.js';
import { createSubtask } from '../../testing/task-fixtures.js';
import {
	blockedCount,
	bottlenecks,
	buildDependencyGraph,
	criticalPath,
	findCycles
} from './dependency-graph.js';

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

const sub = (
	id: number,
	dependencies: Array<string | number> = [],
	status: Task['status'] = 'pending'
): Subtask =>
	createSubtask({
		id,
		title: `Subtask ${id}`,
		status,
		dependencies: dependencies.map(String)
	});

describe('buildDependencyGraph', () => {
	it('adds subtasks under dotted IDs and resolves bare subtask dependencies', () => {
		const graph = buildDependencyGraph([
			task('1', [], 'pending', [sub(1), sub(2, [1]), sub(3, ['2.1'])]),
			task('2', ['1.2'])
		]);

		expect([...graph.nodes.keys()]).toEqual(['1', '1.1', '1.2', '1.3', '2']);
		expect(graph.nodes.get('1.2')?.dependencies).toEqual(['1.1']);
		expect(graph.nodes.get('1.3')?.missing).toEqual(['2.1']);
		expect(graph.nodes.get('2')?.dependencies).toEqual(['1.2']);
	});

	it('records unknown dependency IDs as missing and ignores self-dependencies', () => {
		const graph = buildDependencyGraph([task('1', ['1', '9'])]);

		expect(graph.nodes.get('1')?.dependencies).toEqual([]);
		expect(graph.nodes.get('1')?.missing).toEqual(['9']);
	});
});

describe('blockedCount', () => {
	it('counts everything downstream, transitively', () => {
		const counts = blockedCount([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['1'])
		]);

		expect(counts.get('1')).toBe(3);
		expect(counts.get('2')).toBe(1);
		expect(counts.get('3')).toBe(0);
		expect(counts.get('4')).toBe(0);
	});

	it('counts a diamond join once', () => {
		const counts = blockedCount([
			task('1'),
			task('2', ['1']),
			task('3', ['1']),
			task('4', ['2', '3'])
		]);

		expect(counts.get('1')).toBe(3);
	});

	it('leaves done tasks out of the graph', () => {
		const counts = blockedCount([
			task('1'),
			task('2', ['1'], 'done'),
			task('3', ['2']),
			task('4', ['1'])
		]);

		// 2 is finished, so it is neither blocked by 1 nor a path from 1 to 3
		expect(counts.get('1')).toBe(1);
		expect(counts.get('2')).toBe(0);
	});

	it('terminates on cycles and never counts a task as blocking itself', () => {
		const counts = blockedCount([
			task('1', ['3']),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['3'])
		]);

		expect(counts.get('1')).toBe(3);
		expect(counts.get('3')).toBe(3);
		expect(counts.get('4')).toBe(0);
	});

	it('ignores missing dependencies', () => {
		const counts = blockedCount([task('1', ['99']), task('2', ['1'])]);

		expect(counts.get('1')).toBe(1);
		expect(counts.has('99')).toBe(false);
	});

	it('counts subtasks, including ones other tasks depend on by dotted ID', () => {
		const counts = blockedCount([
			task('1', [], 'pending', [sub(1), sub(2, [1])]),
			task('2', ['1.1'])
		]);

		expect(counts.get('1.1')).toBe(2);
	});
});

describe('criticalPath', () => {
	it('returns the longest chain, dependencies first', () => {
		const path = criticalPath([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['1']),
			task('5')
		]);

		expect(path).toEqual(['1', '2', '3']);
	});

	it('picks the longer branch of a diamond', () => {
		const path = criticalPath([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['1']),
			task('5', ['3', '4'])
		]);

		expect(path).toEqual(['1', '2', '3', '5']);
	});

	it('leaves done tasks out of the chain', () => {
		const path = criticalPath([
			task('1', [], 'done'),
			task('2', ['1']),
			task('3', ['2'])
		]);

		expect(path).toEqual(['2', '3']);
	});

	it('returns an empty chain when everything is done or there are no tasks', () => {
		expect(criticalPath([])).toEqual([]);
		expect(criticalPath([task('1', [], 'done')])).toEqual([]);
	});

	it('skips tasks caught in a cycle but keeps the rest', () => {
		const path = criticalPath([
			task('1', ['2']),
			task('2', ['1']),
			task('3'),
			task('4', ['3'])
		]);

		expect(path).toEqual(['3', '4']);
	});

	it('ignores missing dependencies', () => {
		expect(criticalPath([task('1', ['99']), task('2', ['1'])])).toEqual([
			'1',
			'2'
		]);
	});

	it('breaks ties by lowest ID', () => {
		expect(criticalPath([task('2'), task('10'), task('1')])).toEqual(['1']);
	});

	it('follows subtask dependencies', () => {
		const path = criticalPath([
			task('1', [], 'pending', [sub(1), sub(2, [1])]),
			task('2', ['1.2'])
		]);

		expect(path).toEqual(['1.1', '1.2', '2']);
	});
});

describe('statuses', () => {
	it('treats done, completed and cancelled as finished, everything else as open', () => {
		const tasks = [
			task('1'),
			task('2', ['1'], 'deferred'),
			task('3', ['1'], 'blocked'),
			task('4', ['1'], 'review'),
			task('5', ['1'], 'completed'),
			task('6', ['1'], 'cancelled'),
			task('7', ['1'], 'done')
		];

		expect(blockedCount(tasks).get('1')).toBe(3);
		expect(blockedCount(tasks).get('5')).toBe(0);
		expect(criticalPath(tasks)).toEqual(['1', '2']);
	});

	it('leaves completed and cancelled tasks out of the critical path', () => {
		const tasks = [
			task('1', [], 'completed'),
			task('2', ['1'], 'cancelled'),
			task('3', ['2'])
		];

		expect(criticalPath(tasks)).toEqual(['3']);
	});

	it('lets a deferred task stand on the critical path', () => {
		const tasks = [task('1', [], 'deferred'), task('2', ['1'])];

		expect(criticalPath(tasks)).toEqual(['1', '2']);
	});
});

describe('ties and cycles with finished tasks', () => {
	it('breaks an equal-length diamond by lowest ID', () => {
		const path = criticalPath([
			task('1'),
			task('3', ['1']),
			task('2', ['1']),
			task('4', ['2', '3'])
		]);

		expect(path).toEqual(['1', '2', '4']);
	});

	it('orders IDs numerically, not alphabetically', () => {
		expect(criticalPath([task('10'), task('2')])).toEqual(['2']);
		expect(
			criticalPath([task('1'), task('10', ['1']), task('2', ['1'])])
		).toEqual(['1', '2']);
	});

	it('does not treat a loop through a done task as a cycle for the critical path', () => {
		const tasks = [task('1', ['2']), task('2', ['1'], 'done')];

		expect(criticalPath(tasks)).toEqual(['1']);
		expect(blockedCount(tasks).get('1')).toBe(0);
		expect(findCycles(tasks)).toEqual([['1', '2']]);
	});

	it('counts the other members of an open cycle as blocked', () => {
		const counts = blockedCount([
			task('1', ['2']),
			task('2', ['1']),
			task('3', ['2'])
		]);

		expect(counts.get('1')).toBe(2);
		expect(counts.get('3')).toBe(0);
	});

	it('resolves a bare string dependency on a subtask as a sibling', () => {
		const path = criticalPath([
			task('1', [], 'pending', [sub(1), sub(2, ['1'])]),
			task('2', ['1.2'])
		]);

		expect(path).toEqual(['1.1', '1.2', '2']);
	});
});

describe('bottlenecks', () => {
	const tasks = [
		task('1'),
		task('2'),
		task('3', ['2']),
		task('4', ['2']),
		task('5', ['3']),
		task('10', ['1']),
		task('11', ['1', '10'])
	];

	it('ranks open tasks by what they hold up, ties by lowest ID', () => {
		expect(bottlenecks(tasks).map((b) => [b.id, b.blocks])).toEqual([
			['2', 3],
			['1', 2],
			['3', 1],
			['10', 1]
		]);
	});

	it('keeps only the top few', () => {
		expect(bottlenecks(tasks, 2).map((b) => b.id)).toEqual(['2', '1']);
		expect(bottlenecks(tasks, 0)).toEqual([]);
	});

	it('skips finished tasks and ones that block nothing', () => {
		const ranked = bottlenecks([
			task('1', [], 'done'),
			task('2', ['1']),
			task('3')
		]);

		expect(ranked).toEqual([]);
	});

	it('returns plain data that survives JSON', () => {
		const ranked = bottlenecks(tasks, 1);

		expect(JSON.parse(JSON.stringify(ranked))).toEqual([
			{ id: '2', title: 'Task 2', status: 'pending', blocks: 3 }
		]);
	});
});

describe('findCycles', () => {
	it('returns no cycles for an acyclic graph', () => {
		expect(findCycles([task('1'), task('2', ['1'])])).toEqual([]);
	});

	it('finds a simple cycle', () => {
		expect(findCycles([task('1', ['2']), task('2', ['1']), task('3')])).toEqual(
			[['1', '2']]
		);
	});

	it('reports each separate cycle once, sorted by ID', () => {
		const cycles = findCycles([
			task('10', ['11']),
			task('11', ['10']),
			task('2', ['3']),
			task('3', ['4']),
			task('4', ['2'])
		]);

		expect(cycles).toEqual([
			['2', '3', '4'],
			['10', '11']
		]);
	});

	it('does not treat a self-dependency or a diamond as a cycle', () => {
		const cycles = findCycles([
			task('1', ['1']),
			task('2', ['1']),
			task('3', ['1']),
			task('4', ['2', '3'])
		]);

		expect(cycles).toEqual([]);
	});

	it('finds cycles through subtask dependencies', () => {
		const cycles = findCycles([
			task('1', ['2.1']),
			task('2', [], 'pending', [sub(1, [2]), sub(2, [1])])
		]);

		expect(cycles).toEqual([['2.1', '2.2']]);
	});

	it('reports a 10k two-way chain as one cycle without overflowing the stack', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
		const loop = ids.map((id, i) =>
			task(
				id,
				[ids[i - 1], ids[i + 1]].filter((d) => d !== undefined)
			)
		);

		const cycles = findCycles(loop);

		expect(cycles).toHaveLength(1);
		expect(cycles[0]).toHaveLength(10_000);
		expect(criticalPath(loop)).toEqual([]);
		expect(blockedCount(loop).get('1')).toBe(9_999);
	});

	it('handles a 10k dependency chain without overflowing the stack', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
		const chain = ids.map((id, i) => task(id, i ? [ids[i - 1]] : []));

		expect(criticalPath(chain)).toHaveLength(10_000);
		expect(findCycles(chain)).toEqual([]);
		expect(blockedCount(chain).get('1')).toBe(9_999);
	});

	it('counts a 10k wide graph quickly', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
		const wide = [
			task('0'),
			...ids.map((id) => task(id, ['0'])),
			task('end', ids)
		];
		const started = Date.now();

		const counts = blockedCount(wide);

		expect(counts.get('0')).toBe(10_001);
		expect(Date.now() - started).toBeLessThan(2000);
	});

	it('still reports a cycle that includes done tasks', () => {
		// Done tasks cannot block anything, but the cycle is still bad data
		expect(findCycles([task('1', ['2'], 'done'), task('2', ['1'])])).toEqual([
			['1', '2']
		]);
	});
});
