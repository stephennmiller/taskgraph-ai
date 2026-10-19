/**
 * @fileoverview Unit tests for GithubCommand (tm-core is mocked)
 */

import type { PushPlan, PushResult } from '@tm/core';
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
			unlink: vi.fn().mockResolvedValue({
				tag: 'master',
				taskId: '1',
				issueNumber: 5,
				url: 'https://github.com/acme/app/issues/5'
			})
		};
		command = new GithubCommand();
		(command as any).tmCore = {
			github,
			config: { getActiveTag: vi.fn().mockReturnValue('master') }
		};
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

	describe('push', () => {
		it('defaults to the active tag and asks before writing', async () => {
			await (command as any).runPush({});

			expect(github.planPush).toHaveBeenCalledWith(
				expect.objectContaining({ tag: 'master' })
			);
			expect(confirm).toHaveBeenCalledTimes(1);
			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({ tag: 'master', dryRun: false })
			);
			expect(output()).toContain('1 to create, 1 to update, 1 unchanged');
		});

		it('pushes every tag with --all-tags', async () => {
			await (command as any).runPush({ allTags: true, yes: true });

			expect(github.planPush).toHaveBeenCalledWith(
				expect.objectContaining({ tag: undefined })
			);
		});

		it('rejects --tag together with --all-tags', async () => {
			await expect(
				(command as any).runPush({ tag: 'a', allTags: true })
			).rejects.toThrow('--tag');
			expect(github.push).not.toHaveBeenCalled();
		});

		it('splits --id into task ids', async () => {
			await (command as any).runPush({ id: '1, 2', yes: true });

			expect(github.push).toHaveBeenCalledWith(
				expect.objectContaining({ taskIds: ['1', '2'] })
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
