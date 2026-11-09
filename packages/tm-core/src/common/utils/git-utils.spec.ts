import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gitRef, runGit, runGitSync } from './git-utils.js';

describe('runGit', () => {
	let repo: string;

	beforeEach(() => {
		repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-git-')));
		runGitSync(['init', '--quiet'], { cwd: repo });
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	it('returns git stdout', async () => {
		const { stdout } = await runGit(['rev-parse', '--is-inside-work-tree'], {
			cwd: repo
		});

		expect(stdout.trim()).toBe('true');
	});

	it("rejects with git's message and exit code", async () => {
		const failure = runGit(['rev-parse', '--verify', 'no-such-ref'], {
			cwd: repo
		});

		await expect(failure).rejects.toMatchObject({
			code: 128,
			stderr: expect.stringContaining('fatal')
		});
	});

	it('passes arguments to git without a shell', async () => {
		const marker = path.join(repo, 'marker');

		await expect(
			runGit(['rev-parse', '--verify', `$(touch ${marker}); touch ${marker}`], {
				cwd: repo
			})
		).rejects.toThrow();
		expect(fs.existsSync(marker)).toBe(false);
	});

	it('never runs the core.fsmonitor program the repository names', () => {
		const marker = path.join(repo, 'marker');
		const hook = path.join(repo, 'fsmonitor.sh');
		fs.writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
		runGitSync(['config', 'core.fsmonitor', hook], { cwd: repo });

		runGitSync(['status', '--porcelain'], { cwd: repo });

		expect(fs.existsSync(marker)).toBe(false);
	});

	it('kills git at the timeout', async () => {
		const failure = runGit(['-c', 'alias.hang=!sleep 10', 'hang'], {
			cwd: repo,
			timeoutMs: 200
		});

		await expect(failure).rejects.toMatchObject({ killed: true });
	});
});

describe('gitRef', () => {
	it('refuses a ref git would read as an option', () => {
		expect(() => gitRef('--output=/tmp/pwned')).toThrow(/starts with "-"/);
		expect(() => gitRef('-D')).toThrow(/starts with "-"/);
	});

	it('passes an ordinary ref through', () => {
		expect(gitRef('taskgraph/task-1')).toBe('taskgraph/task-1');
	});
});
