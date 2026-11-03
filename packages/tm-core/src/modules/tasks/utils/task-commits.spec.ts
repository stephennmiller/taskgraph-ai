import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findTaskCommits, taskCommitTag } from './task-commits.js';

describe('findTaskCommits', () => {
	let dir: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: dir, stdio: 'ignore' });

	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	it('finds the commits tagged with the task, newest first, and not 3.1 or 31 for 3', async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-task-commits-'));
		git('init', '-q');
		git('config', 'user.email', 't@example.com');
		git('config', 'user.name', 'T');
		for (const message of [
			`feat(db): tables ${taskCommitTag('3')}`,
			`feat(db): index ${taskCommitTag('3.1')}`,
			`feat(api): routes ${taskCommitTag('31')}`,
			`fix(db): nulls ${taskCommitTag('3')}`
		]) {
			git('commit', '-q', '--allow-empty', '-m', message);
		}

		const commits = await findTaskCommits(dir, '3');

		expect(commits.map((c) => c.subject)).toEqual([
			'fix(db): nulls [task 3]',
			'feat(db): tables [task 3]'
		]);
		expect(commits[0].sha).toMatch(/^[0-9a-f]{7,}$/);
		expect(await findTaskCommits(dir, '3.1')).toHaveLength(1);
	});

	it('is empty outside a git repository', async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-task-commits-'));

		expect(await findTaskCommits(dir, '3')).toEqual([]);
	});
});
