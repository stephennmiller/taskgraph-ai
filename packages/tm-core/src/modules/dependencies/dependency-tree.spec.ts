import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { buildDependencyTree } from './dependency-tree.js';

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

const shape = (nodes: ReturnType<typeof buildDependencyTree>['roots']): any =>
	nodes.map((n) => [n.id, ...(n.children.length ? [shape(n.children)] : [])]);

describe('buildDependencyTree', () => {
	it('nests each task under what it depends on', () => {
		const tree = buildDependencyTree([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4')
		]);

		expect(shape(tree.roots)).toEqual([['1', [['2', [['3']]]]], ['4']]);
		expect(tree.total).toBe(4);
	});

	it('places a task with several dependencies under its deepest one, once', () => {
		// 4 needs 2 (depth 1) and 3 (depth 2): it belongs after 3
		const tree = buildDependencyTree([
			task('1'),
			task('2', ['1']),
			task('3', ['2']),
			task('4', ['2', '3'])
		]);

		expect(shape(tree.roots)).toEqual([['1', [['2', [['3', [['4']]]]]]]]);
		const four = tree.roots[0].children[0].children[0].children[0];
		expect(four.alsoNeeds).toEqual(['2']);
	});

	it('sorts siblings by numeric ID', () => {
		const tree = buildDependencyTree([
			task('10', ['1']),
			task('2', ['1']),
			task('1')
		]);

		expect(tree.roots[0].children.map((c) => c.id)).toEqual(['2', '10']);
	});

	it('reports dependencies that match no task', () => {
		const tree = buildDependencyTree([task('1', ['99'])]);

		expect(tree.roots[0].id).toBe('1');
		expect(tree.roots[0].missing).toEqual(['99']);
	});

	it('returns tasks stuck in a cycle separately instead of looping', () => {
		const tree = buildDependencyTree([
			task('1'),
			task('2', ['3']),
			task('3', ['2'])
		]);

		expect(shape(tree.roots)).toEqual([['1']]);
		expect(tree.cyclic.map((n) => n.id)).toEqual(['2', '3']);
	});

	it('returns just the subtree under rootId', () => {
		const tree = buildDependencyTree(
			[task('1'), task('2', ['1']), task('3', ['2']), task('4', ['1'])],
			{ rootId: '2' }
		);

		expect(shape(tree.roots)).toEqual([['2', [['3']]]]);
		expect(tree.total).toBe(2);
	});

	it('throws for an unknown rootId', () => {
		expect(() => buildDependencyTree([task('1')], { rootId: '9' })).toThrow(
			'Task 9 not found'
		);
	});

	it('ignores a task depending on itself', () => {
		const tree = buildDependencyTree([task('1', ['1'])]);

		expect(shape(tree.roots)).toEqual([['1']]);
		expect(tree.cyclic).toEqual([]);
	});
});
