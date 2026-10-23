import { describe, expect, it } from 'vitest';
import { parsePorcelainPaths, parseWorktreeList } from './task-worktrees.js';

describe('parsePorcelainPaths', () => {
	it('lists each changed path, skipping the source of a rename', () => {
		const output = [
			' M src/a.ts',
			'M  src/b.ts',
			'R  src/new.ts',
			'src/old.ts',
			'A  name with spaces.md',
			''
		].join('\0');

		expect(parsePorcelainPaths(output)).toEqual([
			'src/a.ts',
			'src/b.ts',
			'src/new.ts',
			'name with spaces.md'
		]);
	});

	it('returns nothing for a clean tree', () => {
		expect(parsePorcelainPaths('')).toEqual([]);
	});
});

describe('parseWorktreeList', () => {
	it('maps each worktree to its branch, or null when detached', () => {
		const output = [
			'worktree /repo',
			'HEAD 1111',
			'branch refs/heads/main',
			'',
			'worktree /repo/.taskgraph/worktrees/task-3',
			'HEAD 2222',
			'branch refs/heads/taskgraph/task-3',
			'',
			'worktree /tmp/detached',
			'HEAD 3333',
			'detached',
			''
		].join('\n');

		expect([...parseWorktreeList(output)]).toEqual([
			['/repo', 'refs/heads/main'],
			['/repo/.taskgraph/worktrees/task-3', 'refs/heads/taskgraph/task-3'],
			['/tmp/detached', null]
		]);
	});
});
