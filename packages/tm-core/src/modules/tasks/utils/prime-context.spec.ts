import { describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { rankNextTasks, selectNextTask } from './next-task.js';
import { PRIME_RULES, buildPrimeContext } from './prime-context.js';

describe('buildPrimeContext', () => {
	it('returns the rules and empty lists for a project with no tasks', () => {
		const context = buildPrimeContext([], { tag: 'master' });

		expect(context).toEqual({
			tag: 'master',
			counts: { total: 0, done: 0 },
			inProgress: [],
			ready: [],
			rules: PRIME_RULES
		});
	});

	it('lists the top three ready tasks in next order when nothing is in progress', () => {
		const tasks = [
			createTask({ id: 1, title: 'Low', priority: 'low' }),
			createTask({ id: 2, title: 'High', priority: 'high' }),
			createTask({ id: 3, title: 'Medium' }),
			createTask({ id: 4, title: 'Critical', priority: 'critical' }),
			createTask({ id: 5, title: 'Waits on 1', dependencies: ['1'] }),
			createTask({ id: 6, title: 'Shipped', status: 'done' })
		];

		const context = buildPrimeContext(tasks, { tag: 'master' });

		expect(context.inProgress).toEqual([]);
		expect(context.ready.map((t) => t.id)).toEqual(['4', '2', '3']);
		expect(context.ready[0].id).toBe(selectNextTask(tasks)?.id);
		expect(context.counts).toEqual({ total: 6, done: 1 });
	});

	it('shows the in-progress task with its acceptance criteria', () => {
		const context = buildPrimeContext(
			[
				createTask({
					id: 1,
					title: 'Login endpoint',
					status: 'in-progress',
					testStrategy: 'Run the auth tests',
					acceptanceCriteria: ['Returns 401 on a bad password', ' ']
				})
			],
			{ tag: 'feature' }
		);

		expect(context.inProgress).toEqual([
			{
				id: '1',
				title: 'Login endpoint',
				status: 'in-progress',
				priority: 'medium',
				doneWhen: ['Returns 401 on a bad password']
			}
		]);
	});

	it('falls back to the test strategy, then to nothing, for done-when', () => {
		const context = buildPrimeContext(
			[
				createTask({
					id: 1,
					title: 'Has a strategy',
					status: 'in-progress',
					testStrategy: '  Unit tests pass  '
				}),
				createTask({ id: 2, title: 'Has neither', status: 'in-progress' })
			],
			{ tag: 'master' }
		);

		expect(context.inProgress.map((t) => t.doneWhen)).toEqual([
			['Unit tests pass'],
			[]
		]);
	});

	it('shows an in-progress subtask instead of its parent, and ready siblings after it', () => {
		const context = buildPrimeContext(
			[
				createTask({
					id: 3,
					title: 'Auth',
					status: 'in-progress',
					priority: 'high',
					subtasks: [
						createSubtask({ id: 1, title: 'Schema', status: 'done' }),
						createSubtask({
							id: 2,
							title: 'Endpoint',
							status: 'in-progress',
							testStrategy: 'curl returns 200'
						}),
						createSubtask({ id: 3, title: 'Docs', dependencies: [2] }),
						createSubtask({ id: 4, title: 'Rate limit' })
					]
				}),
				createTask({ id: 4, title: 'Settings page' })
			],
			{ tag: 'master' }
		);

		expect(context.inProgress).toEqual([
			{
				id: '3.2',
				title: 'Endpoint',
				status: 'in-progress',
				priority: 'medium',
				parentTitle: 'Auth',
				doneWhen: ['curl returns 200']
			}
		]);
		// 3.3 waits on 3.2; 3 itself is in progress, so it isn't "ready"
		expect(context.ready.map((t) => [t.id, t.parentTitle])).toEqual([
			['3.4', 'Auth'],
			['4', undefined]
		]);
	});

	it('keeps long titles whole (the CLI cuts them to the terminal)', () => {
		const title = 'A'.repeat(200);
		const context = buildPrimeContext([createTask({ id: 1, title })], {
			tag: 'master'
		});

		expect(context.ready[0].title).toBe(title);
	});

	it('honours readyLimit', () => {
		const tasks = [1, 2, 3, 4, 5].map((id) =>
			createTask({ id, title: `Task ${id}` })
		);

		expect(
			buildPrimeContext(tasks, { tag: 'master', readyLimit: 5 }).ready
		).toHaveLength(5);
	});
});

describe('rankNextTasks', () => {
	it('puts ready subtasks of in-progress tasks before top-level tasks', () => {
		const ranked = rankNextTasks([
			createTask({ id: 1, title: 'Urgent', priority: 'critical' }),
			createTask({
				id: 2,
				title: 'Started',
				status: 'in-progress',
				subtasks: [createSubtask({ id: 1, title: 'Step', parentId: '2' })]
			})
		]);

		expect(ranked.map((t) => t.id)).toEqual(['2.1', '1', '2']);
	});

	it('returns nothing when no task is eligible', () => {
		expect(
			rankNextTasks([createTask({ id: 1, title: 'Done', status: 'done' })])
		).toEqual([]);
	});
});

describe('PRIME_RULES', () => {
	it('has five rules, each short enough to print within 80 columns', () => {
		expect(PRIME_RULES).toHaveLength(5);
		for (const rule of PRIME_RULES) {
			expect(`  1. ${rule.text}`.length).toBeLessThanOrEqual(80);
			expect(`     ${rule.command}`.length).toBeLessThanOrEqual(80);
		}
	});
});
