import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { claimNextInTasks, resolveClaimant, withoutClaim } from './claim.js';

const task = (id: string, fields: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	...fields
});

describe('resolveClaimant', () => {
	it('prefers the TaskGraph session ID', () => {
		expect(
			resolveClaimant({
				TASKGRAPH_SESSION_ID: 'tg-1',
				CLAUDE_CODE_SESSION_ID: 'cc-1',
				USER: 'steve'
			})
		).toBe('tg-1');
	});

	it("falls back to Claude Code's session ID, then the user name", () => {
		expect(resolveClaimant({ CLAUDE_CODE_SESSION_ID: 'cc-1', USER: 'a' })).toBe(
			'cc-1'
		);
		expect(resolveClaimant({ USER: 'steve' })).toBe('steve');
		expect(resolveClaimant({ USERNAME: 'win' })).toBe('win');
	});

	it('ignores blank values', () => {
		expect(resolveClaimant({ TASKGRAPH_SESSION_ID: '  ', USER: 'steve' })).toBe(
			'steve'
		);
	});
});

describe('claimNextInTasks', () => {
	it('skips tasks already in progress', () => {
		const tasks = [task('1', { status: 'in-progress' }), task('2')];

		const result = claimNextInTasks(tasks, 'alice', '2026-10-22T00:00:00Z');

		expect(result?.claim).toMatchObject({
			claimedBy: 'alice',
			claimedAt: '2026-10-22T00:00:00Z'
		});
		expect(result?.claim.task.id).toBe('2');
		expect(result?.tasks[1]).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'alice', claimedAt: '2026-10-22T00:00:00Z' }
		});
		// The input is left alone
		expect(tasks[1].status).toBe('pending');
	});

	it('returns null when nothing is ready', () => {
		const tasks = [
			task('1', { status: 'done' }),
			task('2', { status: 'in-progress' }),
			task('3', { dependencies: ['4'] }),
			task('4', { status: 'blocked' })
		];

		expect(claimNextInTasks(tasks, 'alice')).toBeNull();
	});
	it("leaves the subtasks of a task someone else claimed to them", () => {
		const tasks = [
			task('1', {
				status: 'in-progress',
				metadata: { claimedBy: 'alice' },
				subtasks: [
					{
						id: 1,
						parentId: '1',
						title: 'Sub',
						description: '',
						status: 'pending',
						dependencies: [],
						details: '',
						testStrategy: '',
						priority: 'medium'
					}
				]
			}),
			task('2')
		];

		expect(claimNextInTasks(tasks, 'bob')?.claim.task.id).toBe('2');
		expect(claimNextInTasks(tasks, 'alice')?.claim.task.id).toBe('1.1');
	});
});

describe('withoutClaim', () => {
	it('removes only the claim keys', () => {
		expect(
			withoutClaim({ claimedBy: 'a', claimedAt: 'b', externalId: 'x' })
		).toEqual({ externalId: 'x' });
	});

	it('returns undefined when the claim was all there was', () => {
		expect(withoutClaim({ claimedBy: 'a', claimedAt: 'b' })).toBeUndefined();
	});

	it('returns the same object when there is no claim', () => {
		const metadata = { externalId: 'x' };
		expect(withoutClaim(metadata)).toBe(metadata);
	});
});
