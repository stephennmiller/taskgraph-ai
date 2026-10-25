import { describe, expect, it } from 'vitest';
import type { Task } from '../../common/types/index.js';
import { explainBlockers } from './explain-blockers.js';

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

/**
 * Compact view of a blocker tree: "id" or "id:kind" ("id:parent" for the
 * parent a subtask inherits blockers from), children nested
 */
const shape = (nodes: ReturnType<typeof explainBlockers>['blockers']): any =>
	nodes.map((n) => {
		const label = n.kind
			? `${n.id}:${n.kind}`
			: n.parentOf
				? `${n.id}:parent`
				: n.id;
		return n.blockers.length ? [label, shape(n.blockers)] : [label];
	});

describe('explainBlockers', () => {
	it('throws for an unknown task', () => {
		expect(() => explainBlockers([task('1')], '9')).toThrow('Task 9 not found');
	});

	it('reports a task with no dependencies as not blocked', () => {
		const result = explainBlockers([task('1')], '1');

		expect(result).toMatchObject({
			id: '1',
			status: 'pending',
			blocked: false,
			blockers: [],
			rootCauses: []
		});
	});

	it('reports a task whose dependencies are all done as not blocked', () => {
		const result = explainBlockers(
			[
				task('1', [], 'done'),
				task('2', [], 'cancelled'),
				task('3', ['1', '2'])
			],
			'3'
		);

		expect(result.blocked).toBe(false);
		expect(result.blockers).toEqual([]);
	});

	it('reports a finished task as not blocked even with open dependencies', () => {
		const result = explainBlockers([task('1'), task('2', ['1'], 'done')], '2');

		expect(result.blocked).toBe(false);
	});

	it('follows a chain of unfinished dependencies down to the task that is ready', () => {
		const result = explainBlockers(
			[task('1'), task('2', ['1']), task('3', ['2'])],
			'3'
		);

		expect(result.blocked).toBe(true);
		expect(shape(result.blockers)).toEqual([['2', [['1:ready']]]]);
		expect(result.rootCauses).toEqual([
			{ id: '1', title: 'Task 1', status: 'pending', kind: 'ready' }
		]);
	});

	it('skips finished dependencies along the way', () => {
		const result = explainBlockers(
			[task('1', [], 'done'), task('2', ['1']), task('3', ['2', '1'])],
			'3'
		);

		expect(shape(result.blockers)).toEqual([['2:ready']]);
	});

	it('lists every root cause of a diamond once and shows the shared task once', () => {
		const result = explainBlockers(
			[task('1'), task('2', ['1']), task('3', ['1']), task('4', ['2', '3'])],
			'4'
		);

		expect(shape(result.blockers)).toEqual([
			['2', [['1:ready']]],
			['3', [['1:ready']]]
		]);
		expect(result.rootCauses.map((c) => c.id)).toEqual(['1']);
		const repeated = result.blockers[1].blockers[0];
		expect(repeated.repeated).toBe(true);
		expect(result.blockers[0].blockers[0].repeated).toBeUndefined();
	});

	it('names a dependency ID that matches no task as a root cause', () => {
		const result = explainBlockers([task('1', ['99']), task('2', ['1'])], '2');

		expect(shape(result.blockers)).toEqual([['1', [['99:missing']]]]);
		expect(result.rootCauses).toEqual([
			{ id: '99', kind: 'missing', listedBy: ['1'] }
		]);
	});

	it('names deferred and blocked dependencies as stalled, not ready', () => {
		const result = explainBlockers(
			[
				task('1', [], 'deferred'),
				task('2', [], 'blocked'),
				task('3', ['1', '2'])
			],
			'3'
		);

		expect(shape(result.blockers)).toEqual([['1:stalled'], ['2:stalled']]);
		expect(result.rootCauses.map((c) => c.kind)).toEqual([
			'stalled',
			'stalled'
		]);
	});

	it('treats in-progress and review dependencies as ready', () => {
		const result = explainBlockers(
			[
				task('1', [], 'in-progress'),
				task('2', [], 'review'),
				task('3', ['1', '2'])
			],
			'3'
		);

		expect(shape(result.blockers)).toEqual([['1:ready'], ['2:ready']]);
	});

	it('stops at a dependency cycle and reports its members', () => {
		const result = explainBlockers(
			[task('1', ['2']), task('2', ['3']), task('3', ['1']), task('4', ['1'])],
			'4'
		);

		expect(shape(result.blockers)).toEqual([
			['1', [['2', [['3', [['1:cycle']]]]]]]
		]);
		expect(result.rootCauses).toEqual([
			{
				id: '1',
				title: 'Task 1',
				status: 'pending',
				kind: 'cycle',
				cycle: ['1', '2', '3'],
				edges: [{ from: '3', to: '1' }]
			}
		]);
	});

	it('explains a task that is itself in a cycle', () => {
		const result = explainBlockers([task('1', ['2']), task('2', ['1'])], '1');

		expect(result.blocked).toBe(true);
		expect(shape(result.blockers)).toEqual([['2', [['1:cycle']]]]);
		expect(result.rootCauses.map((c) => c.kind)).toEqual(['cycle']);
	});

	it('reports a cycle once even when reached by two routes', () => {
		const result = explainBlockers(
			[
				task('1', ['2']),
				task('2', ['1']),
				task('3', ['1']),
				task('4', ['1']),
				task('5', ['3', '4'])
			],
			'5'
		);

		expect(result.rootCauses.filter((c) => c.kind === 'cycle')).toHaveLength(1);
	});

	it('explains subtasks by dotted ID, resolving sibling dependencies', () => {
		const result = explainBlockers(
			[task('1', [], 'pending', [sub(1), sub(2, [1]), sub(3, ['1.2'])])],
			'1.3'
		);

		expect(shape(result.blockers)).toEqual([['1.2', [['1.1:ready']]]]);
	});

	it('reports a task that depends on itself as a one-task cycle', () => {
		const result = explainBlockers([task('2', ['2'])], '2');

		expect(result.blocked).toBe(true);
		expect(shape(result.blockers)).toEqual([['2:cycle']]);
		expect(result.rootCauses).toEqual([
			{
				id: '2',
				title: 'Task 2',
				status: 'pending',
				kind: 'cycle',
				cycle: ['2'],
				edges: [{ from: '2', to: '2' }]
			}
		]);
	});

	it('reports a subtask that depends on itself', () => {
		const result = explainBlockers(
			[task('1', [], 'pending', [sub(1, [1])])],
			'1.1'
		);

		expect(shape(result.blockers)).toEqual([['1.1:cycle']]);
		expect(result.rootCauses[0]).toMatchObject({
			kind: 'cycle',
			edges: [{ from: '1.1', to: '1.1' }]
		});
	});

	it('finds a self-dependency further down the chain', () => {
		const result = explainBlockers([task('1', ['1']), task('2', ['1'])], '2');

		expect(shape(result.blockers)).toEqual([['1', [['1:cycle']]]]);
	});

	it('ignores the self-dependency of a finished task', () => {
		expect(explainBlockers([task('1', ['1'], 'done')], '1').blocked).toBe(
			false
		);
	});

	it('lists every task that names a missing ID', () => {
		const result = explainBlockers(
			[task('1', ['99']), task('2', ['99']), task('3', ['1', '2'])],
			'3'
		);

		expect(result.rootCauses).toEqual([
			{ id: '99', kind: 'missing', listedBy: ['1', '2'] }
		]);
	});

	it('lists every back edge of a cycle', () => {
		// 1 -> 2 -> 1 and 1 -> 3 -> 1
		const result = explainBlockers(
			[task('1', ['2', '3']), task('2', ['1']), task('3', ['1'])],
			'1'
		);

		expect(result.rootCauses).toHaveLength(1);
		expect(result.rootCauses[0].edges).toEqual([
			{ from: '2', to: '1' },
			{ from: '3', to: '1' }
		]);
	});

	it('explains a very long chain without overflowing the stack', () => {
		const ids = Array.from({ length: 10_000 }, (_, i) => String(i + 1));
		const chain = ids.map((id, i) => task(id, i ? [ids[i - 1]] : []));

		const result = explainBlockers(chain, '10000');

		expect(result.rootCauses).toEqual([
			expect.objectContaining({ id: '1', kind: 'ready' })
		]);
	});

	it('lets a task depend on a subtask', () => {
		const result = explainBlockers(
			[task('1', [], 'pending', [sub(1)]), task('2', ['1.1'])],
			'2'
		);

		expect(shape(result.blockers)).toEqual([['1.1:ready']]);
	});

	describe("subtasks inherit their parent's blockers", () => {
		it('shows what the parent waits on under the parent', () => {
			// Before: 2.1 was "not blocked" though task 2 waits on task 1
			const result = explainBlockers(
				[task('1'), task('2', ['1'], 'pending', [sub(1)])],
				'2.1'
			);

			expect(result.blocked).toBe(true);
			expect(shape(result.blockers)).toEqual([['2:parent', [['1:ready']]]]);
			expect(result.blockers[0].parentOf).toBe('2.1');
			expect(result.rootCauses.map((c) => c.id)).toEqual(['1']);
		});

		it("is not blocked once the parent's dependencies are done", () => {
			const result = explainBlockers(
				[task('1', [], 'done'), task('2', ['1'], 'pending', [sub(1)])],
				'2.1'
			);

			expect(result.blocked).toBe(false);
		});

		it("keeps the subtask's own blockers next to the inherited ones", () => {
			const result = explainBlockers(
				[task('1'), task('2', ['1'], 'pending', [sub(1), sub(2, [1])])],
				'2.2'
			);

			// The sibling inherits the same blockers, so the parent points back
			expect(shape(result.blockers)).toEqual([
				['2:parent', [['1:ready']]],
				['2.1', [['2:parent']]]
			]);
			expect(result.blockers[1].blockers[0].repeated).toBe(true);
		});

		it('follows inherited blockers of subtasks further down the chain', () => {
			const result = explainBlockers(
				[task('1'), task('2', ['1'], 'pending', [sub(1)]), task('3', ['2.1'])],
				'3'
			);

			expect(shape(result.blockers)).toEqual([
				['2.1', [['2:parent', [['1:ready']]]]]
			]);
		});

		it("reports the parent's missing dependencies, listed by the parent", () => {
			const result = explainBlockers(
				[task('2', ['9'], 'pending', [sub(1)])],
				'2.1'
			);

			expect(shape(result.blockers)).toEqual([['2:parent', [['9:missing']]]]);
			expect(result.rootCauses).toEqual([
				{ id: '9', kind: 'missing', listedBy: ['2'] }
			]);
		});

		it("ignores a parent's dependency on its own subtask", () => {
			const result = explainBlockers(
				[task('2', ['2.2'], 'pending', [sub(1), sub(2)])],
				'2.1'
			);

			expect(result.blocked).toBe(false);
		});

		it('ignores a finished parent', () => {
			const result = explainBlockers(
				[task('1'), task('2', ['1'], 'done', [sub(1)])],
				'2.1'
			);

			expect(result.blocked).toBe(false);
		});

		it("names the parent's dependency when an inherited edge closes a loop", () => {
			// 2 needs 4, 4 needs 2.1, and 2.1 waits on what 2 waits on
			const result = explainBlockers(
				[task('2', ['4'], 'pending', [sub(1)]), task('4', ['2.1'])],
				'2.1'
			);

			expect(shape(result.blockers)).toEqual([
				['2:parent', [['4', [['2.1:cycle']]]]]
			]);
			expect(result.rootCauses).toEqual([
				expect.objectContaining({
					kind: 'cycle',
					cycle: ['2.1', '4'],
					edges: [{ from: '4', to: '2.1' }]
				})
			]);
		});

		it("does not count a task's own subtask as its blocker (#658)", () => {
			const result = explainBlockers(
				[task('1'), task('2', ['1', '2.1'], 'pending', [sub(1)])],
				'2'
			);

			expect(shape(result.blockers)).toEqual([['1:ready']]);
		});

		it('reports a loop back to the path through a parent on it', () => {
			// Explaining 2: 2 → 4 → 2.1, which waits on 4 through task 2
			const result = explainBlockers(
				[task('2', ['4'], 'pending', [sub(1)]), task('4', ['2.1'])],
				'2'
			);

			expect(shape(result.blockers)).toEqual([
				['4', [['2.1', [['2:parent', [['4:cycle']]]]]]]
			]);
			expect(result.rootCauses[0].edges).toEqual([{ from: '2', to: '4' }]);
		});
	});
});
