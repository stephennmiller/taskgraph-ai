/**
 * @fileoverview TaskWorktrees.changedFiles against a real git repository:
 * what an interrupted loop task left uncommitted (#998)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskWorktrees } from './task-worktrees.js';

describe('TaskWorktrees.changedFiles', () => {
	let root: string;
	let project: string;
	const git = (...args: string[]) =>
		execFileSync('git', args, { cwd: root, encoding: 'utf8' });
	const write = (file: string, text = 'x\n') => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		fs.writeFileSync(path.join(root, file), text);
	};

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-changed-'));
		project = path.join(root, 'app');
		git('init', '-q', '-b', 'main');
		git('config', 'user.email', 't@example.com');
		git('config', 'user.name', 'T');
		write('app/a.ts');
		write('app/.taskgraph/tasks/tasks.json', '{}\n');
		git('add', '.');
		git('commit', '-qm', 'start');
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('lists edited and new files relative to the project, without TaskGraph state or the progress file', async () => {
		write('app/a.ts', 'edited\n');
		write('app/new.ts');
		write('app/.taskgraph/tasks/tasks.json', '{"claimed":true}\n');
		write('app/.taskgraph/progress.txt');
		write('outside.ts');

		const files = await new TaskWorktrees(project).changedFiles(
			path.join(project, '.taskgraph/progress.txt')
		);

		expect(files.sort()).toEqual(['../outside.ts', 'a.ts', 'new.ts']);
	});

	it('is empty for a clean tree', async () => {
		expect(
			await new TaskWorktrees(project).changedFiles(
				path.join(project, '.taskgraph/progress.txt')
			)
		).toEqual([]);
	});
});
