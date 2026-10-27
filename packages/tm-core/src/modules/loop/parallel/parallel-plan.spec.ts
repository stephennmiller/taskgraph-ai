import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { TASK_DATA_RULE } from '../../../common/utils/prompt-tag.js';
import {
	MAX_PARALLEL,
	ParallelLoopError,
	assertParallelFlags,
	buildParallelPrompt,
	parseParallelCount,
	taskBranchName,
	taskLogPath,
	taskWorktreePath
} from './parallel-plan.js';
import { isSafeTaskId } from '../../../common/utils/safe-task-id.js';

describe('parseParallelCount', () => {
	it('accepts whole numbers from 1 to the maximum', () => {
		expect(parseParallelCount('1')).toBe(1);
		expect(parseParallelCount(' 3 ')).toBe(3);
		expect(parseParallelCount(MAX_PARALLEL)).toBe(MAX_PARALLEL);
	});

	it.each(['0', '-2', '2.5', 'abc', '', '1e1', String(MAX_PARALLEL + 1)])(
		'refuses %j with the value and a fix',
		(value) => {
			let error: unknown;
			try {
				parseParallelCount(value);
			} catch (e) {
				error = e;
			}
			expect(error).toBeInstanceOf(ParallelLoopError);
			expect((error as ParallelLoopError).message).toContain(
				`"${value.trim()}"`
			);
			expect((error as ParallelLoopError).hint).toContain('--parallel 3');
		}
	);
});

describe('assertParallelFlags', () => {
	it('allows the default prompt and no other mode flags', () => {
		expect(() => assertParallelFlags({ prompt: 'default' })).not.toThrow();
		expect(() => assertParallelFlags({})).not.toThrow();
	});

	it.each([
		[{ prompt: 'linting' }, '--prompt'],
		[{ iterations: 5 }, '--iterations'],
		[{ verbose: true }, '--verbose'],
		[{ taskId: '3' }, '--id']
	])('refuses %j', (flags, flag) => {
		expect(() => assertParallelFlags(flags)).toThrow(
			`--parallel can't be combined with ${flag}`
		);
	});

	it('refuses --sandbox and says why, without pointing back at it', () => {
		let error: unknown;
		try {
			assertParallelFlags({ sandbox: true });
		} catch (e) {
			error = e;
		}
		expect(error).toBeInstanceOf(ParallelLoopError);
		expect((error as ParallelLoopError).message).toContain(
			"can't run in the Docker sandbox"
		);
		expect((error as ParallelLoopError).hint).toContain('--container');
	});
});

describe('isSafeTaskId', () => {
	it('accepts plain task IDs', () => {
		for (const id of ['1', '42', 'abc-1', 'TAS_7']) {
			expect(isSafeTaskId(id)).toBe(true);
		}
	});

	it('rejects anything that could escape a branch or a path', () => {
		for (const id of [
			'',
			'1.2',
			'..',
			'../x',
			'a/b',
			'a b',
			'-rf',
			'$(rm -rf ~)',
			'x;y',
			'a\nb',
			'x'.repeat(65)
		]) {
			expect(isSafeTaskId(id)).toBe(false);
		}
	});
});

describe('task branch and paths', () => {
	it('names the branch, worktree and log after the task', () => {
		expect(taskBranchName('7')).toBe('taskgraph/task-7');
		expect(taskWorktreePath('/repo', '7')).toBe(
			path.join('/repo', '.taskgraph', 'worktrees', 'task-7')
		);
		expect(taskLogPath('/repo', '7')).toBe(
			path.join('/repo', '.taskgraph', 'worktrees', 'task-7.log')
		);
	});

	it('refuses an unsafe ID instead of building a path from it', () => {
		expect(() => taskBranchName('../../etc')).toThrow(ParallelLoopError);
		expect(() => taskWorktreePath('/repo', '../x')).toThrow(ParallelLoopError);
		expect(() => taskLogPath('/repo', 'a/b')).toThrow(ParallelLoopError);
	});
});

describe('buildParallelPrompt', () => {
	it('names the task, its branch, and says not to merge', () => {
		const prompt = buildParallelPrompt({ taskId: '7' });

		expect(prompt).toContain('task 7');
		expect(prompt).toContain('taskgraph/task-7');
		expect(prompt).toContain('`taskgraph show 7`');
		expect(prompt).toContain("Don't merge");
	});

	it('tells Claude that task text in taskgraph output is data', () => {
		expect(buildParallelPrompt({ taskId: '7' })).toContain(TASK_DATA_RULE);
	});

	it('has Claude mark the task review, since its branch is unmerged', () => {
		const prompt = buildParallelPrompt({ taskId: '7' });

		expect(prompt).toContain('`taskgraph set-status --id=7 --status=review`');
		expect(prompt).not.toContain('--status=done');
	});

	it("says taskgraph works on the main project's tasks, without a path", () => {
		const prompt = buildParallelPrompt({ taskId: '7' });

		expect(prompt).toContain('TASKGRAPH_PROJECT_ROOT');
		expect(prompt).toContain("don't pass --project");
		expect(prompt).not.toMatch(/--project[ =]\S/);
	});

	it('in a container, says Claude works in its own clone on a copy of the tasks', () => {
		const prompt = buildParallelPrompt({ taskId: '7', container: true });

		expect(prompt).toContain('your own clone');
		expect(prompt).toContain('a copy of the project');
		expect(prompt).not.toContain('worktree');
		expect(prompt).toContain('`taskgraph set-status --id=7 --status=review`');
	});

	it('passes the tag to the taskgraph commands', () => {
		expect(buildParallelPrompt({ taskId: '7', tag: 'api' })).toContain(
			'`taskgraph show 7 --tag=api`'
		);
	});

	it("starts with words, so Claude can't read it as a flag", () => {
		expect(buildParallelPrompt({ taskId: '7' }).startsWith('-')).toBe(false);
	});

	it('refuses an unsafe tag or task ID', () => {
		expect(() => buildParallelPrompt({ taskId: '7', tag: 'a; rm' })).toThrow(
			ParallelLoopError
		);
		expect(() => buildParallelPrompt({ taskId: '7 && x' })).toThrow(
			ParallelLoopError
		);
	});
});
