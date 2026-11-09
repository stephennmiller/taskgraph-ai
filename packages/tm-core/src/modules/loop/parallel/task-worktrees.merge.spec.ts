/**
 * @fileoverview TaskWorktrees.merge against a real git repository (#973)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskWorktrees } from './task-worktrees.js';

describe('TaskWorktrees.merge', () => {
	let root: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	const commit = (file: string, text: string) => {
		fs.writeFileSync(path.join(root, file), text);
		git('add', file);
		git('commit', '-qm', `edit ${file}`);
	};

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-merge-'));
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@example.com');
		git('config', 'user.name', 'T');
		commit('a.txt', 'one\n');
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('merges a branch that merges cleanly', async () => {
		git('checkout', '-qb', 'taskgraph/task-1');
		commit('b.txt', 'new\n');
		git('checkout', '-q', 'main');
		commit('a.txt', 'two\n');

		expect(await new TaskWorktrees(root).merge('taskgraph/task-1')).toBe(true);
		expect(fs.readFileSync(path.join(root, 'b.txt'), 'utf8')).toBe('new\n');
	});

	it('undoes a conflicting merge and says it failed', async () => {
		git('checkout', '-qb', 'taskgraph/task-1');
		commit('a.txt', 'theirs\n');
		git('checkout', '-q', 'main');
		commit('a.txt', 'ours\n');

		expect(await new TaskWorktrees(root).merge('taskgraph/task-1')).toBe(false);
		expect(git('status', '--porcelain')).toBe('');
		expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('ours\n');
	});

	it('sets a branch aside under a new name, removing its worktree', async () => {
		const worktree = path.join(root, 'wt');
		git('worktree', 'add', '-q', '-b', 'taskgraph/task-1', worktree);
		const tg = new TaskWorktrees(root);

		expect(await tg.setAside(worktree, 'taskgraph/task-1')).toBe(
			'taskgraph/task-1-conflict-1'
		);
		expect(fs.existsSync(worktree)).toBe(false);
		expect(git('branch', '--list', 'taskgraph/*').trim()).toBe(
			'taskgraph/task-1-conflict-1'
		);
	});

	it('leaves a worktree with uncommitted changes alone', async () => {
		const worktree = path.join(root, 'wt');
		git('worktree', 'add', '-q', '-b', 'taskgraph/task-1', worktree);
		fs.writeFileSync(path.join(worktree, 'a.txt'), 'dirty\n');

		expect(
			await new TaskWorktrees(root).setAside(worktree, 'taskgraph/task-1')
		).toBeUndefined();
		expect(fs.existsSync(path.join(worktree, 'a.txt'))).toBe(true);
	});

	// A --container task's folder is a clone, not a worktree (#1068)
	describe('a branch with no worktree', () => {
		const withBranch = () => {
			git('branch', 'taskgraph/task-1');
			return path.join(root, '.taskgraph', 'worktrees', 'task-1');
		};

		it('sets the branch aside', async () => {
			const clone = withBranch();

			expect(
				await new TaskWorktrees(root).setAside(clone, 'taskgraph/task-1')
			).toBe('taskgraph/task-1-conflict-1');
			expect(git('branch', '--list', 'taskgraph/*').trim()).toBe(
				'taskgraph/task-1-conflict-1'
			);
		});

		it('deletes the merged branch', async () => {
			const clone = withBranch();

			expect(
				await new TaskWorktrees(root).remove(clone, 'taskgraph/task-1', true)
			).toBe(true);
			expect(git('branch', '--list', 'taskgraph/*').trim()).toBe('');
		});
	});
});
