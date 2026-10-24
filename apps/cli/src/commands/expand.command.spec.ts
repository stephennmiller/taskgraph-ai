/**
 * @fileoverview Unit tests for `expand`: what it hands tm-core, what it
 * prints for one task and for --all, and its exit codes.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: () => '/test/project'
}));

vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: () => false
}));

import { createTmCore } from '@tm/core';
import { ExpandCommand } from './expand.command.js';

const expand = vi.fn();
const expandAll = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(...args: string[]) {
	return new ExpandCommand().parseAsync(args, { from: 'user' });
}

const expanded = {
	task: { id: '3', subtasks: [] },
	tag: 'master',
	addedSubtasks: [
		{ id: 1, title: 'Write the \x1b[31mparser' },
		{ id: 2, title: 'Test it' }
	],
	hadSubtasks: false,
	telemetryData: null,
	tagInfo: null
};

describe('expand', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		process.exitCode = undefined;
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(strip(a.join(' ')));
		});
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(strip(a.join(' ')));
		});
		vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
			throw new Error(`exit ${code}`);
		}) as never);
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: { expand, expandAll },
			config: { getActiveTag: () => 'master' }
		} as any);
		expand.mockResolvedValue(expanded);
	});

	it('passes the options to tm-core and lists the new subtasks', async () => {
		await run(
			'--id=3',
			'--num=2',
			'--research',
			'--prompt=Use Postgres',
			'--force',
			'--complexity-report=reports/r.json'
		);

		expect(expand).toHaveBeenCalledWith(
			{
				id: '3',
				num: '2',
				research: true,
				prompt: 'Use Postgres',
				force: true,
				complexityReportPath: '/test/project/reports/r.json',
				tag: 'master',
				outputType: 'cli'
			},
			expect.any(Object)
		);
		const text = out.join('\n');
		expect(text).toContain('✓ Added 2 subtasks to task 3');
		expect(text).toContain('3.1  Write the parser');
		expect(text).not.toContain('\x1b[31m');
	});

	it('prints the warnings tm-core reports', async () => {
		expand.mockImplementation(async (_input, hooks) => {
			hooks.onWarning('Could not read or parse complexity report: \x1b[31mbad');
			return expanded;
		});

		await run('--id=3');

		expect(out.join('\n')).toContain(
			'⚠ Could not read or parse complexity report: bad'
		);
	});

	it('says so when the complexity report recommends no subtasks', async () => {
		expand.mockResolvedValue({
			...expanded,
			addedSubtasks: [],
			skipped: 'complexity-report'
		});

		await run('--id=3');

		expect(out.join('\n')).toContain(
			'Task 3 needs no subtasks, per the complexity report'
		);
		expect(process.exitCode).toBeUndefined();
	});

	it('stops with a usage error, before tm-core, without --id or --all', async () => {
		await expect(run()).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('Missing task ID');
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('refuses a tasks file other than the project tasks.json', async () => {
		await expect(run('--id=3', '--file=/tmp/other.json')).rejects.toThrow(
			'exit 1'
		);

		expect(err.join('\n')).toContain('--file is no longer supported');
		expect(expand).not.toHaveBeenCalled();
	});

	it('prints a failure once with its hint and exits 1', async () => {
		expand.mockRejectedValue(new Error('Task 9 not found'));

		await expect(run('--id=9')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('Task 9 not found');
	});

	describe('--all', () => {
		it('prints each task as it ends, the summary, and exits 1 when one failed', async () => {
			expandAll.mockImplementation(async (_options, hooks) => {
				hooks.onStart(['1', '2']);
				hooks.onTaskDone('1', { ...expanded, task: { id: '1' } });
				hooks.onTaskDone('2', new Error('AI \x1b[31mdown'));
				return {
					tag: 'master',
					expandedCount: 1,
					skippedCount: 0,
					failedCount: 1,
					tasksToExpand: 2,
					alreadyExpandedCount: 0,
					telemetryData: null
				};
			});

			await run('--all', '--force');

			expect(expandAll).toHaveBeenCalledWith(
				expect.objectContaining({ force: true, tag: 'master' }),
				expect.any(Object)
			);
			expect(out.join('\n')).toContain('✓ Added 2 subtasks to task 1');
			expect(err.join('\n')).toContain("✗ Couldn't expand task 2: AI down");
			expect(out.join('\n')).toContain('✓ Expanded 1 task · 1 failed');
			expect(process.exitCode).toBe(1);
		});

		it('says why nothing was expanded', async () => {
			expandAll.mockResolvedValue({
				tag: 'master',
				expandedCount: 0,
				skippedCount: 0,
				failedCount: 0,
				tasksToExpand: 0,
				alreadyExpandedCount: 2,
				telemetryData: null
			});

			await run('--all');

			expect(out.join('\n')).toContain(
				'No pending tasks to expand: 2 already have subtasks'
			);
			expect(process.exitCode).toBeUndefined();
		});
	});
});
