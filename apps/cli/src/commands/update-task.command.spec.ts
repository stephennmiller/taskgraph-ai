/**
 * @fileoverview Unit tests for `update-task` and `update`: what they hand
 * tm-core, what they print, and their exit codes.
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
import { UpdateCommand, UpdateTaskCommand } from './update-task.command.js';

const updateWithPrompt = vi.fn();
const updateFrom = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const task = { id: '3', title: 'Store \x1b[31msessions', subtasks: [] };
const usage = {
	modelUsed: 'sonnet',
	inputTokens: 10,
	outputTokens: 5,
	totalTokens: 15
};

describe('update-task and update', () => {
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
			tasks: { updateWithPrompt, updateFrom },
			config: { getActiveTag: () => 'master' }
		} as any);
		updateWithPrompt.mockResolvedValue({
			task,
			tag: 'master',
			telemetryData: usage,
			tagInfo: null
		});
		updateFrom.mockResolvedValue({
			tag: 'master',
			sentCount: 2,
			updatedTasks: [task, { id: '4', title: 'Write docs' }],
			telemetryData: usage,
			tagInfo: null
		});
	});

	const updateTask = (...args: string[]) =>
		new UpdateTaskCommand().parseAsync(args, { from: 'user' });
	const update = (...args: string[]) =>
		new UpdateCommand().parseAsync(args, { from: 'user' });

	it('update-task hands tm-core the task and prompt, then confirms the rewrite', async () => {
		await updateTask('--id=3', '--prompt=Use SQLite', '--research');

		expect(updateWithPrompt).toHaveBeenCalledWith(
			{
				id: '3',
				prompt: 'Use SQLite',
				research: true,
				append: undefined,
				tag: 'master',
				outputType: 'cli'
			},
			expect.any(Object)
		);
		const printed = out.join('\n');
		expect(printed).toContain('✓ Updated task 3  Store sessions');
		expect(printed).toContain('Run taskgraph show 3 to see what changed');
		expect(printed).toContain('15 tokens');
		expect(printed).not.toContain('\x1b[31m');
	});

	it('update-task takes the ID and prompt words as arguments', async () => {
		await updateTask('3', 'use', 'sqlite', '--tag=feature');

		expect(updateWithPrompt.mock.calls[0][0]).toMatchObject({
			id: '3',
			prompt: 'use sqlite',
			tag: 'feature'
		});
	});

	it('update-task --append shows the notes it added', async () => {
		updateWithPrompt.mockResolvedValue({
			task,
			tag: 'master',
			appended: 'Keep the alias table.',
			telemetryData: null,
			tagInfo: null
		});

		await updateTask('--id=3', '--prompt=Note it', '--append');

		expect(out.join('\n')).toContain('✓ Added notes to task 3  Store sessions');
		expect(out.join('\n')).toContain('Keep the alias table.');
	});

	it('update-task on a done task exits 1 with the fix', async () => {
		updateWithPrompt.mockResolvedValue({
			task,
			tag: 'master',
			skipped: 'done',
			telemetryData: null,
			tagInfo: null
		});

		await updateTask('--id=3', '--prompt=x');

		expect(process.exitCode).toBe(1);
		expect(err.join('\n')).toContain(
			"✗ Task 3 is done, so it can't be updated"
		);
		expect(err.join('\n')).toContain(
			'taskgraph set-status --id=3 --status=pending'
		);
	});

	it.each([
		[[] as string[], 'Missing task ID'],
		[['--id=3'], 'Missing prompt']
	])('update-task %o exits 1 before tm-core', async (args, message) => {
		await expect(updateTask(...args)).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain(message);
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('update-task prints a tm-core error once and exits 1', async () => {
		updateWithPrompt.mockRejectedValue(new Error('Task 9 not found'));

		await expect(updateTask('--id=9', '--prompt=x')).rejects.toThrow('exit 1');

		expect(err.filter((l) => l.includes('Task 9 not found'))).toHaveLength(1);
	});

	it('update hands tm-core the start ID and lists the tasks it changed', async () => {
		await update('--from=3', '--prompt=Use TypeScript');

		expect(updateFrom).toHaveBeenCalledWith(
			{
				from: '3',
				prompt: 'Use TypeScript',
				research: undefined,
				tag: 'master',
				outputType: 'cli'
			},
			expect.any(Object)
		);
		const printed = out.join('\n');
		expect(printed).toContain('✓ Updated 2 tasks');
		expect(printed).toContain('  3  Store sessions');
		expect(printed).toContain('  4  Write docs');
	});

	it('update says when there is nothing to update', async () => {
		updateFrom.mockResolvedValue({
			tag: 'master',
			sentCount: 0,
			updatedTasks: [],
			telemetryData: null,
			tagInfo: null
		});

		await update('--from=9', '--prompt=x');

		expect(out.join('\n')).toContain(
			'No tasks to update: none from 9 on are unfinished'
		);
		expect(process.exitCode).toBeUndefined();
	});

	it.each([
		[
			['--id=3', '--prompt=x'],
			'The update command uses --from=<id>, not --id=<id>'
		],
		[['--from=3'], 'Missing prompt']
	])('update %o exits 1 before tm-core', async (args, message) => {
		await expect(update(...args)).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain(message);
		expect(createTmCore).not.toHaveBeenCalled();
	});
});
