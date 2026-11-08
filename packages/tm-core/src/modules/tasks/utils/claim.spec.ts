import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import { setTaskStatusIn } from '../../storage/adapters/file-storage/task-updates.js';
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
	it('leaves the subtasks of a task someone else claimed to them', () => {
		const tasks = [
			task('1', {
				status: 'in-progress',
				metadata: { claimedBy: 'alice' },
				subtasks: [
					{
						id: '1',
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

	it('lets others take the subtasks once the claimant moves the task on (#1034)', () => {
		const tasks = [
			task('7', {
				status: 'in-progress',
				metadata: { claimedBy: 'alice', claimedAt: 'then' },
				subtasks: [
					{
						id: '1',
						parentId: '7',
						title: 'Sub',
						description: '',
						status: 'pending',
						dependencies: [],
						details: '',
						testStrategy: '',
						priority: 'medium'
					}
				]
			})
		];

		// A stuck loop blocks it, then someone starts it again by hand
		const blocked = setTaskStatusIn(tasks, '7', 'blocked', {}).tasks ?? [];
		const restarted =
			setTaskStatusIn(blocked, '7', 'in-progress', {}).tasks ?? [];

		expect(blocked[0].metadata).toBeUndefined();
		expect(claimNextInTasks(restarted, 'bob')?.claim.task.id).toBe('7.1');
	});

	it('starts a pending parent before claiming its subtasks (#1034)', () => {
		const tasks = [
			task('5', {
				subtasks: [
					{
						id: '1',
						parentId: '5',
						title: 'Sub',
						description: '',
						status: 'pending',
						dependencies: [],
						details: '',
						testStrategy: '',
						priority: 'medium'
					}
				]
			})
		];

		const first = claimNextInTasks(tasks, 'alice');
		const second = claimNextInTasks(first?.tasks ?? [], 'alice');

		expect(first?.claim.task.id).toBe('5');
		expect(second?.claim.task.id).toBe('5.1');
		expect(second?.tasks[0].status).toBe('in-progress');
		expect(second?.tasks[0].subtasks[0].status).toBe('in-progress');
	});

	it('picks only from the given task IDs, never a subtask', () => {
		const tasks = [
			task('1', {
				status: 'in-progress',
				subtasks: [
					{
						id: '1',
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
			task('2', { priority: 'high' }),
			task('3')
		];

		expect(
			claimNextInTasks(tasks, 'alice', undefined, undefined, {
				among: new Set(['1', '3'])
			})?.claim.task.id
		).toBe('3');
		expect(
			claimNextInTasks(tasks, 'alice', undefined, undefined, {
				among: new Set(['1'])
			})
		).toBeNull();
	});
});

describe('claimNextInTasks and the claiming process (#1044)', () => {
	const host = os.hostname();
	const deadPid = spawnSync(process.execPath, ['-e', '']).pid;

	it('records the process that holds the claim', () => {
		const result = claimNextInTasks([task('1')], 'alice', 'now', undefined, {
			pid: process.pid
		});

		expect(result?.tasks[0].metadata).toEqual({
			claimedBy: 'alice',
			claimedAt: 'now',
			claimPid: process.pid,
			claimHost: host
		});
	});

	it('resumes a task whose claiming process died, before unstarted ones', () => {
		const tasks = [
			task('1', { priority: 'high' }),
			task('2', {
				status: 'in-progress',
				metadata: {
					claimedBy: 'alice',
					claimedAt: 'then',
					claimPid: deadPid,
					claimHost: host
				}
			})
		];

		const result = claimNextInTasks(tasks, 'bob', 'now');

		expect(result?.claim.task.id).toBe('2');
		// No pid this time, so none of the dead one's is kept
		expect(result?.tasks[1].metadata).toEqual({
			claimedBy: 'bob',
			claimedAt: 'now'
		});
	});

	it('does not hand out a task reopened from review as a dead run (#1044)', () => {
		const reviewed = task('1', {
			status: 'review',
			metadata: {
				claimedBy: 'alice',
				claimedAt: 'then',
				claimPid: deadPid,
				claimHost: host
			}
		});
		const reopened =
			setTaskStatusIn([reviewed, task('2')], '1', 'in-progress', {}).tasks ??
			[];

		expect(reopened[0].metadata).toEqual({
			claimedBy: 'alice',
			claimedAt: 'then'
		});
		expect(claimNextInTasks(reopened, 'bob')?.claim.task.id).toBe('2');
	});

	it('leaves a live, pid-less or other-host claim alone', () => {
		const claimed = (id: string, metadata: Record<string, unknown>) =>
			task(id, {
				status: 'in-progress',
				metadata: { claimedBy: 'alice', ...metadata }
			});
		const tasks = [
			claimed('1', { claimPid: process.pid, claimHost: host }),
			claimed('2', {}),
			claimed('3', { claimPid: deadPid, claimHost: 'elsewhere' }),
			task('4')
		];

		expect(claimNextInTasks(tasks, 'bob')?.claim.task.id).toBe('4');
		expect(claimNextInTasks(tasks, 'alice')?.claim.task.id).toBe('4');
	});
});

describe('withoutClaim', () => {
	it('removes only the claim keys', () => {
		expect(
			withoutClaim({
				claimedBy: 'a',
				claimedAt: 'b',
				claimPid: 1,
				claimHost: 'h',
				externalId: 'x'
			})
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
