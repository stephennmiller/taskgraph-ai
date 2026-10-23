import { describe, expect, it } from 'vitest';
import { getSuggestedActions } from './suggested-actions.js';

const commands = (actions: { command: string }[]) =>
	actions.map((action) => action.command);

describe('getSuggestedActions', () => {
	it('suggests starting a pending task', () => {
		const actions = commands(getSuggestedActions(3, 'pending', false));
		expect(actions[0]).toBe('taskgraph set-status --id=3 --status=in-progress');
		expect(actions).toContain('taskgraph expand --id=3');
	});

	it('never suggests starting a task that is already in progress', () => {
		const actions = commands(getSuggestedActions(3, 'in-progress', true));
		expect(actions.some((c) => c.includes('--status=in-progress'))).toBe(false);
		expect(actions).toContain('taskgraph set-status --id=3 --status=done');
	});

	it('suggests logging progress with note for an in-progress task or subtask', () => {
		expect(commands(getSuggestedActions('3.2', 'in-progress', false))[0]).toBe(
			'taskgraph note 3.2 "..."'
		);
		expect(commands(getSuggestedActions(3, 'in-progress', true))[0]).toBe(
			'taskgraph note 3 "..."'
		);
	});

	it('does not suggest expanding a subtask or a task that already has subtasks', () => {
		expect(
			commands(getSuggestedActions('3.2', 'pending', false)).some((c) =>
				c.startsWith('taskgraph expand')
			)
		).toBe(false);
		expect(
			commands(getSuggestedActions(3, 'pending', true)).some((c) =>
				c.startsWith('taskgraph expand')
			)
		).toBe(false);
	});

	it('points finished tasks at the next task instead', () => {
		for (const status of ['done', 'completed', 'cancelled']) {
			expect(commands(getSuggestedActions(1, status, false))).toEqual([
				'taskgraph next'
			]);
		}
	});

	it('suggests returning blocked and deferred tasks to pending', () => {
		for (const status of ['blocked', 'deferred']) {
			expect(commands(getSuggestedActions(6, status, false))[0]).toBe(
				'taskgraph set-status --id=6 --status=pending'
			);
		}
	});

	it('suggests finishing or reopening a task in review', () => {
		expect(commands(getSuggestedActions(5, 'review', false))).toEqual([
			'taskgraph set-status --id=5 --status=done',
			'taskgraph set-status --id=5 --status=in-progress'
		]);
	});
});
