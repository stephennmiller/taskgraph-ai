import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { reconcileDependencySources } from './dependency-provenance.js';
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
	describe('analysis', () => {
		it('returns bottlenecks and the critical path for the whole tag', () => {
			const tree = buildDependencyTree([
				task('1'),
				task('2', ['1']),
				task('3', ['2']),
				task('4', ['1'])
			]);

			expect(tree.bottlenecks.map((b) => [b.id, b.blocks])).toEqual([
				['1', 3],
				['2', 1]
			]);
			expect(tree.criticalPath).toEqual(['1', '2', '3']);
		});

		it('keeps the whole-tag analysis when scoped to a rootId', () => {
			const tree = buildDependencyTree(
				[task('1'), task('2', ['1']), task('3', ['2'])],
				{ rootId: '2' }
			);

			expect(tree.bottlenecks.map((b) => b.id)).toEqual(['1', '2']);
			expect(tree.criticalPath).toEqual(['1', '2', '3']);
		});

		it('limits bottlenecks to the top few', () => {
			const tasks = [task('1')];
			for (let i = 2; i <= 9; i++) tasks.push(task(String(i), [String(i - 1)]));

			expect(buildDependencyTree(tasks).bottlenecks).toHaveLength(5);
		});

		it('is empty when everything is done', () => {
			const tree = buildDependencyTree([
				task('1', [], 'done'),
				task('2', ['1'], 'done')
			]);

			expect(tree.bottlenecks).toEqual([]);
			expect(tree.criticalPath).toEqual([]);
		});
	});

	describe('inferred dependencies', () => {
		const withSources = (t: Task, inferred: string[]): Task =>
			({
				...t,
				metadata: {
					dependencySources: Object.fromEntries(
						inferred.map((d) => [d, 'inferred'])
					)
				}
			}) as Task;

		it('lists the dependencies recorded as inferred on each node', () => {
			const tree = buildDependencyTree([
				task('1'),
				task('2', ['1']),
				withSources(task('3', ['1', '2']), ['1', '2'])
			]);

			const three = tree.roots[0].children[0].children[0];
			expect(three.id).toBe('3');
			expect(three.inferred).toEqual(['1', '2']);
			expect(tree.roots[0].children[0].inferred).toEqual([]);
		});

		it('leaves out the parent edge of a rootId subtree, since the parent is not shown', () => {
			const tree = buildDependencyTree(
				[task('1'), withSources(task('2', ['1']), ['1']), task('3', ['2'])],
				{ rootId: '2' }
			);

			expect(tree.roots[0].inferred).toEqual([]);
		});

		it('keeps inferred marks on other dependencies of a rootId subtree', () => {
			const tree = buildDependencyTree(
				[
					task('1'),
					task('2', ['1']),
					withSources(task('3', ['1', '2']), ['1'])
				],
				{ rootId: '3' }
			);

			expect(tree.roots[0].alsoNeeds).toEqual(['1']);
			expect(tree.roots[0].inferred).toEqual(['1']);
		});

		it('reads the marks the AI paths write, with numeric ids as in tasks.json', () => {
			const numeric = (id: number, dependencies: number[]): Task =>
				({ ...task(String(id)), id, dependencies }) as unknown as Task;
			// update-task kept dependency 1 and the AI added 2
			const three = numeric(3, [1, 2]);
			three.metadata = reconcileDependencySources(three, numeric(3, [1]));

			const tree = buildDependencyTree([
				numeric(1, []),
				numeric(2, [1]),
				three
			]);

			expect(tree.roots[0].children[0].children[0].inferred).toEqual(['2']);
		});

		it('ignores marks for dependencies the task no longer lists', () => {
			const tree = buildDependencyTree([
				task('1'),
				withSources(task('2', ['1']), ['7'])
			]);

			expect(tree.roots[0].children[0].inferred).toEqual([]);
		});
	});
});
