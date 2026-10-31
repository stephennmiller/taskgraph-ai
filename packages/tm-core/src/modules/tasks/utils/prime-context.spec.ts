import { describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import { rankNextTasks, selectNextTask } from './next-task.js';
import { appendNote } from './notes.js';
import {
	PRIME_RULES,
	buildPrimeContext,
	findUnmetCriteria,
	findUnnotedInProgress
} from './prime-context.js';

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
				doneWhen: ['Returns 401 on a bad password'],
				criteria: [{ text: 'Returns 401 on a bad password', checked: false }]
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
				doneWhen: ['curl returns 200'],
				criteria: []
			}
		]);
		// 3.3 waits on 3.2; 3 itself is in progress, so it isn't "ready"
		expect(context.ready.map((t) => [t.id, t.parentTitle])).toEqual([
			['3.4', 'Auth'],
			['4', undefined]
		]);
	});

	it('reads checkable { text, checked } criteria as well as plain strings', () => {
		const context = buildPrimeContext(
			[
				createTask({
					id: 1,
					title: 'Login endpoint',
					status: 'in-progress',
					acceptanceCriteria: [
						{ text: 'Returns 401 on a bad password', checked: true },
						'Rate limited per IP',
						{ text: ' ', checked: false }
					]
				})
			],
			{ tag: 'master' }
		);

		expect(context.inProgress[0].doneWhen).toEqual([
			'Returns 401 on a bad password',
			'Rate limited per IP'
		]);
	});

	it('leaves a pending task out of ready while one of its subtasks is in progress', () => {
		const context = buildPrimeContext(
			[
				createTask({
					id: 1,
					title: 'Auth',
					priority: 'high',
					subtasks: [
						createSubtask({
							id: 1,
							title: 'Endpoint',
							status: 'in-progress',
							parentId: '1'
						})
					]
				}),
				createTask({ id: 2, title: 'Settings page' })
			],
			{ tag: 'master' }
		);

		expect(context.inProgress.map((t) => t.id)).toEqual(['1.1']);
		expect(context.ready.map((t) => t.id)).toEqual(['2']);
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

describe('findUnnotedInProgress', () => {
	const since = new Date('2026-10-23T12:00:00Z');
	const before = '2026-10-23T11:59:59.000Z';
	const after = '2026-10-23T12:05:00.000Z';
	const noted = (at: string) => appendNote('Plan', 'did a thing', at);

	it('lists an in-progress task with no note since the session started', () => {
		const tasks = [
			createTask({
				id: 1,
				title: 'Old note',
				status: 'in-progress',
				details: noted(before)
			}),
			createTask({
				id: 2,
				title: 'Fresh note',
				status: 'in-progress',
				details: noted(after)
			}),
			createTask({ id: 3, title: 'Never noted', status: 'in-progress' }),
			createTask({ id: 4, title: 'Pending', details: '' })
		];

		const unnoted = findUnnotedInProgress(tasks, since);

		expect(unnoted.map((t) => t.id)).toEqual(['1', '3']);
		expect(unnoted[0]).toEqual({
			id: '1',
			title: 'Old note',
			status: 'in-progress',
			priority: 'medium'
		});
	});

	it('checks the in-progress subtask, not its parent', () => {
		const tasks = [
			createTask({
				id: 3,
				title: 'Auth',
				status: 'in-progress',
				subtasks: [
					createSubtask({ id: 1, title: 'Hash passwords', status: 'done' }),
					createSubtask({
						id: 2,
						title: 'Login endpoint',
						status: 'in-progress'
					})
				]
			})
		];

		expect(findUnnotedInProgress(tasks, since)).toEqual([
			{
				id: '3.2',
				title: 'Login endpoint',
				status: 'in-progress',
				priority: 'medium',
				parentTitle: 'Auth'
			}
		]);
	});

	it('counts a note on the parent for its subtask, and on a subtask for its parent', () => {
		const parentNoted = [
			createTask({
				id: 3,
				title: 'Auth',
				details: noted(after),
				subtasks: [
					createSubtask({ id: 2, title: 'Login', status: 'in-progress' })
				]
			})
		];
		const subtaskNoted = [
			createTask({
				id: 5,
				title: 'Billing',
				status: 'in-progress',
				subtasks: [
					createSubtask({
						id: 1,
						title: 'Checkout',
						status: 'done',
						details: noted(after)
					})
				]
			})
		];

		expect(findUnnotedInProgress(parentNoted, since)).toEqual([]);
		expect(findUnnotedInProgress(subtaskNoted, since)).toEqual([]);
	});

	it('returns nothing when no task is in progress', () => {
		expect(
			findUnnotedInProgress([createTask({ id: 1, title: 'Todo' })], since)
		).toEqual([]);
	});
});

describe('findUnmetCriteria', () => {
	it('lists the unchecked criteria of each in-progress task, numbered as --check takes them', () => {
		const { inProgress } = buildPrimeContext(
			[
				createTask({
					id: 1,
					title: 'Login endpoint',
					status: 'in-progress',
					acceptanceCriteria: [
						{ text: 'Returns 401 on a bad password', checked: true },
						'Rate limited per IP'
					]
				}),
				createTask({
					id: 2,
					title: 'All checked',
					status: 'in-progress',
					acceptanceCriteria: [{ text: 'Done', checked: true }]
				}),
				createTask({
					id: 3,
					title: 'Strategy only',
					status: 'in-progress',
					testStrategy: 'Tests pass'
				})
			],
			{ tag: 'master' }
		);

		const unmet = findUnmetCriteria(inProgress);

		expect(unmet.map((u) => [u.task.id, u.unmet])).toEqual([
			['1', [{ number: 2, text: 'Rate limited per IP' }]]
		]);
	});
});
