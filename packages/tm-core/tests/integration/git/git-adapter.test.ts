/**
 * @fileoverview Integration tests for GitAdapter against a real temporary repo.
 * Guards the simple-git wrapper so dependency upgrades (e.g. v3 -> v4) that
 * change option parsing or child-process env handling are caught.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitAdapter } from '../../../src/modules/git/adapters/git-adapter.js';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

describe('GitAdapter (real repository)', () => {
	let repoDir: string;
	let adapter: GitAdapter;

	beforeEach(() => {
		repoDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-git-adapter-'))
		);
		git(repoDir, 'init', '--initial-branch=main');
		git(repoDir, 'config', 'user.email', 'test@example.com');
		git(repoDir, 'config', 'user.name', 'Test User');
		fs.writeFileSync(path.join(repoDir, 'README.md'), '# test\n');
		git(repoDir, 'add', 'README.md');
		git(repoDir, 'commit', '--no-gpg-sign', '-m', 'initial');
		adapter = new GitAdapter(repoDir);
	});

	afterEach(() => {
		fs.rmSync(repoDir, { recursive: true, force: true });
	});

	it('detects the repository and reports its root and git version', async () => {
		expect(await adapter.isGitRepository()).toBe(true);
		expect(await adapter.getRepositoryRoot()).toBe(repoDir);
		const version = await adapter.getGitVersion();
		expect(version.major).toBeGreaterThanOrEqual(2);
	});

	it('returns false outside a repository', async () => {
		const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-not-a-repo-'));
		try {
			expect(await new GitAdapter(plainDir).isGitRepository()).toBe(false);
		} finally {
			fs.rmSync(plainDir, { recursive: true, force: true });
		}
	});

	it('creates, lists, checks out and force-deletes branches', async () => {
		await adapter.createAndCheckoutBranch('feature/one');
		expect(await adapter.getCurrentBranch()).toBe('feature/one');

		await adapter.checkoutBranch('main');
		expect(await adapter.listBranches()).toEqual(
			expect.arrayContaining(['main', 'feature/one'])
		);

		await adapter.deleteBranch('feature/one', { force: true });
		expect(await adapter.branchExists('feature/one')).toBe(false);
	});

	it('stages files, reflects them in status, and unstages them', async () => {
		fs.writeFileSync(path.join(repoDir, 'a.txt'), 'a\n');
		expect(await adapter.hasUntrackedFiles()).toBe(true);

		await adapter.stageFiles(['a.txt']);
		expect(await adapter.hasStagedChanges()).toBe(true);

		await adapter.unstageFiles(['a.txt']);
		expect(await adapter.hasStagedChanges()).toBe(false);
	});

	it('commits with metadata lines via git.raw and exposes it in the log', async () => {
		fs.writeFileSync(path.join(repoDir, 'b.txt'), 'b\n');
		await adapter.stageFiles(['b.txt']);

		await adapter.createCommit('Add b', {
			metadata: { taskId: '2.4', phase: 'implementation' }
		});

		const last = await adapter.getLastCommit();
		expect(last.message).toMatch(/^Add b\b/);
		expect(last.message).toContain('[taskId:2.4]');
		expect(last.message).toContain('[phase:implementation]');
		expect(await adapter.isWorkingTreeClean()).toBe(true);
	});

	it('refuses to commit on a default branch when enforcement is requested', async () => {
		fs.writeFileSync(path.join(repoDir, 'c.txt'), 'c\n');
		await adapter.stageFiles(['c.txt']);

		await expect(
			adapter.createCommit('nope', { enforceNonDefaultBranch: true })
		).rejects.toThrow(/cannot commit to default branch/);
	});
});
