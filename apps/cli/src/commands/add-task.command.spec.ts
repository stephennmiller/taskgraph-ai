/**
 * @fileoverview Unit tests for `add-task`: what it hands tm-core, what it
 * prints, and the usage errors it stops at before any AI call.
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
import { AddTaskCommand } from './add-task.command.js';

const add = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

function run(...args: string[]) {
	return new AddTaskCommand().parseAsync(args, { from: 'user' });
}

describe('add-task', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.clearAllMocks();
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
			tasks: { add },
			config: { getActiveTag: () => 'master' }
		} as any);
		add.mockImplementation(async (_input, hooks) => {
			hooks.onWarning(
				"The AI suggested dependencies that don't exist (9); left them out"
			);
			return {
				task: {
					id: '3',
					title: 'Write the \x1b[31mREADME',
					priority: 'medium'
				},
				tag: 'master',
				dependencies: [{ id: '1', title: 'Set up', addedByAi: false }],
				telemetryData: null,
				tagInfo: null
			};
		});
	});

	it('passes the options to tm-core and prints the warning and result', async () => {
		await run(
			'--title=Write the README',
			'--description=Docs',
			'--dependencies=1, 9',
			'--ac=Has setup',
			'--ac=Has scripts',
			'--discovered-from=2'
		);

		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Write the README',
				description: 'Docs',
				dependencies: ['1', '9'],
				acceptanceCriteria: ['Has setup', 'Has scripts'],
				discoveredFrom: '2',
				// Left to tm-core, which applies global.defaultPriority
				priority: undefined,
				tag: 'master',
				outputType: 'cli'
			}),
			expect.any(Object)
		);
		const text = out.join('\n');
		expect(text).toContain(
			"⚠ The AI suggested dependencies that don't exist (9); left them out"
		);
		expect(text).toContain(
			'✓ Added task 3  Write the README · medium priority'
		);
		expect(text).toContain('  Depends on  1  Set up');
		expect(text).not.toContain('\x1b[31m');
	});

	it.each([
		[['Fix the login bug']],
		// Unquoted words are one title, as in `note`
		[['Fix', 'the', 'login', 'bug']],
		[['--title=Fix the login bug']],
		[['Fix the login bug', '--title=Fix the login bug']]
	])('takes %j as the title, with no prompt (#1149)', async (args) => {
		await run(...args);

		expect(add).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Fix the login bug',
				prompt: undefined,
				description: undefined
			}),
			expect.any(Object)
		);
	});

	it('refuses a title argument and a different --title', async () => {
		await expect(run('Fix login', '--title=Fix logout')).rejects.toThrow(
			'exit 1'
		);

		expect(err.join('\n')).toContain(
			'Give the title once: "Fix login" or --title=Fix logout'
		);
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('stops with a usage error, before tm-core, without a title or a prompt', async () => {
		await expect(run('--description=Only a description')).rejects.toThrow(
			'exit 1'
		);

		expect(err.join('\n')).toContain(
			'add-task needs a title, or --prompt for the AI to write the task'
		);
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('refuses a tasks file other than the project tasks.json', async () => {
		await expect(run('--prompt=p', '--file=/tmp/other.json')).rejects.toThrow(
			'exit 1'
		);

		expect(err.join('\n')).toContain('--file is no longer supported');
		expect(add).not.toHaveBeenCalled();
	});

	it('reads a relative --file from the project root, not the current folder', async () => {
		await run('--prompt=p', '--file=.taskgraph/tasks/tasks.json');

		expect(add).toHaveBeenCalled();
	});

	it('says a title makes no AI call and drops the config key', () => {
		const help = new AddTaskCommand()
			.helpInformation()
			.replace(/\u001b\[[0-9;]*m/g, '')
			.replace(/\s+/g, ' ');

		expect(help).toContain('Add a task; --prompt has the AI write it');
		expect(help).toContain('Task title, saved as written (no AI call)');
		expect(help).not.toContain('global.defaultPriority');
		expect(help).not.toContain('for manual task creation');
		expect(help).not.toContain('Whether to use research');
		expect(help).toContain('unless your config sets one');
	});

	it('prints a failure once with the hint for it and exits 1', async () => {
		add.mockRejectedValue(new Error('Reached maximum number of turns (6)'));

		await expect(run('--prompt=p')).rejects.toThrow('exit 1');

		const text = err.join('\n');
		expect(text).toContain('Reached maximum number of turns (6)');
		expect(text).toContain('Raise claudeCode.maxTurns');
	});
});
