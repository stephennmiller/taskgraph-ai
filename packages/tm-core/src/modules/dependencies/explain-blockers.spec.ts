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

/** Compact view of a blocker tree: "id" or "id:kind", children nested */
const shape = (nodes: ReturnType<typeof explainBlockers>['blockers']): any =>
	nodes.map((n) => {
		const label = n.kind ? `${n.id}:${n.kind}` : n.id;
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
		expect(result.rootCauses).toEqual([{ id: '99', kind: 'missing' }]);
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
				cycle: ['1', '2', '3']
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

	it('lets a task depend on a subtask', () => {
		const result = explainBlockers(
			[task('1', [], 'pending', [sub(1)]), task('2', ['1.1'])],
			'2'
		);

		expect(shape(result.blockers)).toEqual([['1.1:ready']]);
	});
});
