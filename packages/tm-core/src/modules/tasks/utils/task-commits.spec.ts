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

	const repo = (...messages: string[]) => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-task-commits-'));
		git('init', '-q');
		git('config', 'user.email', 't@example.com');
		git('config', 'user.name', 'T');
		for (const message of messages) {
			git('commit', '-q', '--allow-empty', '-m', message);
		}
	};
	const subjects = async (...args: Parameters<typeof findTaskCommits>) =>
		(await findTaskCommits(...args)).map((c) => c.subject);

	it('finds the commits for the task and its subtasks, newest first, and not 31 for 3', async () => {
		repo(
			`feat(db): tables ${taskCommitTag('3')}`,
			`feat(db): index ${taskCommitTag('3.1')}`,
			`feat(api): routes ${taskCommitTag('31')}`,
			`fix(db): nulls ${taskCommitTag('3')}`
		);

		const commits = await findTaskCommits(dir, '3');

		expect(commits.map((c) => c.subject)).toEqual([
			'fix(db): nulls [task 3]',
			'feat(db): index [task 3.1]',
			'feat(db): tables [task 3]'
		]);
		expect(commits[0].sha).toMatch(/^[0-9a-f]{7,}$/);
		expect(await subjects(dir, '3.1')).toEqual(['feat(db): index [task 3.1]']);
	});

	it("keeps master's bare marker and gives other tags their own (#1015)", async () => {
		repo(
			`feat(auth): login page ${taskCommitTag('1', 'master')}`,
			`feat(billing): invoices ${taskCommitTag('1', 'billing')}`
		);

		expect(taskCommitTag('1')).toBe('[task 1]');
		expect(await subjects(dir, '1', { tag: 'master' })).toEqual([
			'feat(auth): login page [task 1]'
		]);
		expect(await subjects(dir, '1', { tag: 'billing' })).toEqual([
			'feat(billing): invoices [task billing/1]'
		]);
	});

	it("leaves out an earlier task's commits when the task has a createdAt", async () => {
		repo(`feat: old task one ${taskCommitTag('1')}`);
		const createdAt = new Date(Date.now() + 60_000).toISOString();

		expect(await subjects(dir, '1', { since: createdAt })).toEqual([]);
		expect(await subjects(dir, '1', { since: 'not a date' })).toHaveLength(1);
	});

	it('is empty outside a git repository', async () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-task-commits-'));

		expect(await findTaskCommits(dir, '3')).toEqual([]);
	});
});
