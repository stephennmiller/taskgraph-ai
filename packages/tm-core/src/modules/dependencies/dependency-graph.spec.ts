import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import {
	blockedCount,
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
) => ({ ...task(String(id), [], status), id, dependencies }) as any;

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

	it('still reports a cycle that includes done tasks', () => {
		// Done tasks cannot block anything, but the cycle is still bad data
		expect(findCycles([task('1', ['2'], 'done'), task('2', ['1'])])).toEqual([
			['1', '2']
		]);
	});
});
