/**
 * @fileoverview Unit tests for GithubCommand (tm-core is mocked)
 */

import type { PullPlan, PullResult, PushPlan, PushResult } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return { ...actual, createTmCore: vi.fn() };
});

vi.mock('../../utils/project-root.js', () => ({
	getProjectRoot: vi.fn((path?: string) => path || '/test/project')
}));

import { GithubCommand } from './github.command.js';

const PLAN: PushPlan = {
	repo: 'acme/app',
	steps: [
		{ action: 'create', tag: 'master', taskId: '1', title: 'First' },
		{
			action: 'update',
			tag: 'master',
			taskId: '2',
			title: 'Second',
			issueNumber: 7,
			reason: 'content changed'
		},
		{ action: 'skip', tag: 'master', taskId: '3', title: 'Third' }
	],
	orphans: [{ issueNumber: 9, url: 'u', title: 'Gone' }]
};

const RESULT = (overrides: Partial<PushResult> = {}): PushResult => ({
	dryRun: false,
	plan: PLAN,
	created: 1,
	updated: 1,
	skipped: 1,
	closed: 0,
	orphans: PLAN.orphans,
	...overrides
});

const PULL_PLAN: PullPlan = {
	repo: 'acme/app',
	steps: [
		{
			action: 'apply',
			tag: 'master',
			taskId: '1',
			title: 'First',
			issueNumber: 1,
			from: 'pending',
			to: 'done'
		},
		{
			action: 'conflict',
			tag: 'master',
			taskId: '2',
			title: 'Second',
			issueNumber: 2,
			from: 'blocked',
			to: 'done',
			reason: 'changed on both sides, the local status is kept'
		},
		{
			action: 'skip',
			tag: 'master',
			taskId: '3',
			title: 'Third',
			reason: 'unchanged'
		}
	]
};

const PULL_RESULT = (overrides: Partial<PullResult> = {}): PullResult => ({
	dryRun: false,
	plan: PULL_PLAN,
	applied: 1,
	synced: 0,
	conflicts: 1,
	skipped: 1,
	...overrides
});

const UP_TO_DATE: PullPlan = {
	repo: 'acme/app',
	steps: [{ action: 'skip', tag: 'master', taskId: '3', title: 'Third' }]
};

describe('GithubCommand', () => {
	let logSpy: any;
	let github: Record<string, ReturnType<typeof vi.fn>>;
	let command: GithubCommand;
	let confirm: ReturnType<typeof vi.fn>;

	const output = () =>
		logSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');

	beforeEach(() => {
		logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		github = {
			status: vi.fn().mockResolvedValue({
				ghAvailable: true,
				repo: 'acme/app',
				linkedTasks: 2,
				unlinkedTasks: 3
			}),
			planPush: vi.fn().mockResolvedValue(PLAN),
			push: vi.fn().mockResolvedValue(RESULT()),
			planPull: vi.fn().mockResolvedValue(PULL_PLAN),
			pull: vi.fn().mockResolvedValue(PULL_RESULT()),
			unlink: vi.fn().mockResolvedValue({
				tag: 'master',
				taskId: '1',
				issueNumber: 5,
				url: 'https://github.com/acme/app/issues/5'
			})
		};
		command = new GithubCommand();
		(command as any).tmCore = { github };
		confirm = vi.fn().mockResolvedValue(true);
		(command as any).confirm = confirm;
		(command as any).isInteractive = () => true;
	});

	afterEach(() => {
		vi.clearAllMocks();
		logSpy.mockRestore();
	});

	describe('status', () => {
		it('prints gh availability, repo and link counts', async () => {
			await (command as any).runStatus({});

			expect(output()).toContain('available and signed in');
			expect(output()).toContain('acme/app');
			expect(output()).toContain('2 task(s)');
			expect(output()).toContain('3 task(s)');
		});

		it('passes --repo through and supports --json', async () => {
			await (command as any).runStatus({ repo: 'o/n', json: true });

			expect(github.status).toHaveBeenCalledWith({ repo: 'o/n' });
			expect(JSON.parse(output()).linkedTasks).toBe(2);
		});
	});

	describe('pull', () => {
		it('previews with --dry-run and writes nothing', async () => {
			github.pull.mockResolvedValue(PULL_RESULT({ dryRun: true }));

			await (command as any).runPull({ dryRun: true });

			expect(github.pull).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: true })
			);
			expect(confirm).not.toHaveBeenCalled();
			expect(output()).toContain('Dry run, nothing written');
			expect(output()).toContain('pending -> done');
		});

		it('asks before updating tasks and then pulls', async () => {
			await (command as any).runPull({});

			expect(github.planPull).toHaveBeenCalledTimes(1);
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(github.pull).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
			expect(output()).toContain('Pull complete');
		});

		it('does not pull when the confirmation is declined', async () => {
			confirm.mockResolvedValue(false);

			await (command as any).runPull({});

			expect(github.pull).not.toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
			expect(output()).toContain('Cancelled');
		});

		it('skips the confirmation with --yes', async () => {
			await (command as any).runPull({ yes: true });

			expect(confirm).not.toHaveBeenCalled();
			expect(github.pull).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
		});

		it('lists conflicts and says the local status is kept', async () => {
			await (command as any).runPull({ yes: true });

			expect(output()).toContain('conflict');
			expect(output()).toContain('blocked');
			expect(output()).toContain('taskgraph github push');
		});

		it('reports up to date without asking or writing', async () => {
			github.planPull.mockResolvedValue(UP_TO_DATE);
			github.pull.mockResolvedValue(
				PULL_RESULT({
					dryRun: true,
					plan: UP_TO_DATE,
					applied: 0,
					conflicts: 0
				})
			);

			await (command as any).runPull({});

			expect(confirm).not.toHaveBeenCalled();
			expect(github.pull).not.toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
			expect(output()).toContain('already up to date');
		});

		it('refuses to write without --yes when it cannot ask', async () => {
			(command as any).isInteractive = () => false;

			await expect((command as any).runPull({})).rejects.toThrow('--yes');
			expect(github.pull).not.toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
		});

		it('forwards repo, tag, all-tags and id to core as given', async () => {
			await (command as any).runPull({
				repo: 'o/n',
				tag: 'feature',
				allTags: false,
				id: '1, 2',
				dryRun: true
			});

			expect(github.pull).toHaveBeenCalledWith({
				repo: 'o/n',
				tag: 'feature',
				allTags: false,
				taskIds: '1, 2',
				dryRun: true
			});
		});

		it('prints JSON with --json', async () => {
			await (command as any).runPull({ yes: true, json: true });

			expect(JSON.parse(output()).applied).toBe(1);
		});
	});

	describe('push', () => {
		it('asks before writing and leaves the tag to core', async () => {
			await (command as any).runPush({});

			expect(github.planPush.mock.calls[0][0].tag).toBeUndefined();
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
			expect(output()).toContain('1 to create, 1 to update, 1 unchanged');
		});

		it('forwards --tag and --all-tags to core', async () => {
			await (command as any).runPush({ tag: 'feature', yes: true });
			await (command as any).runPush({ allTags: true, yes: true });

			expect(github.planPush.mock.calls[0][0]).toMatchObject({
				tag: 'feature'
			});
			expect(github.planPush.mock.calls[1][0]).toMatchObject({
				allTags: true,
				tag: undefined
			});
		});

		it('forwards --id to core as given', async () => {
			await (command as any).runPush({ id: '1, 2', yes: true });

			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({ taskIds: '1, 2' })
			);
		});

		it('forwards repo, details and close-orphans options', async () => {
			await (command as any).runPush({
				yes: true,
				repo: 'o/n',
				includeDetails: true,
				closeOrphans: true
			});

			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({
					repo: 'o/n',
					includeDetails: true,
					closeOrphans: true
				})
			);
		});

		it('shows the plan on --dry-run and never writes or asks', async () => {
			github.push.mockResolvedValue(RESULT({ dryRun: true }));

			await (command as any).runPush({ dryRun: true });

			expect(confirm).not.toHaveBeenCalled();
			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: true })
			);
			expect(output()).toContain('Plan for acme/app');
			expect(output()).toContain('Dry run');
			expect(output()).toContain('#9 Gone');
		});

		it('writes without asking when --yes is given', async () => {
			await (command as any).runPush({ yes: true });

			expect(confirm).not.toHaveBeenCalled();
			expect(github.push).toHaveBeenCalledTimes(1);
		});

		it('does not write when the user declines', async () => {
			confirm.mockResolvedValue(false);

			await (command as any).runPush({});

			expect(github.push).not.toHaveBeenCalled();
			expect(output()).toContain('Cancelled');
		});

		it('refuses to write non-interactively without --yes', async () => {
			(command as any).isInteractive = () => false;

			await expect((command as any).runPush({})).rejects.toThrow('--yes');
			expect(github.push).not.toHaveBeenCalled();
		});

		it('treats --json as non-interactive', async () => {
			await expect((command as any).runPush({ json: true })).rejects.toThrow(
				'--yes'
			);
			expect(github.push).not.toHaveBeenCalled();
		});

		it('does not ask or write when nothing changed', async () => {
			github.planPush.mockResolvedValue({
				...PLAN,
				steps: [PLAN.steps[2]],
				orphans: []
			});

			await (command as any).runPush({});

			expect(confirm).not.toHaveBeenCalled();
			expect(github.push).not.toHaveBeenCalledWith(
				expect.objectContaining({ dryRun: false })
			);
			expect(output()).toContain('up to date');
		});

		it('prints only JSON with --json --yes', async () => {
			await (command as any).runPush({ json: true, yes: true });

			expect(JSON.parse(output()).created).toBe(1);
		});
	});

	describe('unlink', () => {
		it('unlinks by id and tag', async () => {
			await (command as any).runUnlink('1', { tag: 'master' });

			expect(github.unlink).toHaveBeenCalledWith('1', { tag: 'master' });
			expect(output()).toContain('issue #5');
		});
	});
});
