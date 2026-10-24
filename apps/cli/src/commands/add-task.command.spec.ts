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
				"Task 9 doesn't exist; adding the task without that dependency"
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
			"⚠ Task 9 doesn't exist; adding the task without that dependency"
		);
		expect(text).toContain(
			'✓ Added task 3  Write the README · medium priority'
		);
		expect(text).toContain('  Depends on  1  Set up');
		expect(text).not.toContain('\x1b[31m');
	});

	it('stops with a usage error, before tm-core, without a prompt or title and description', async () => {
		await expect(run('--title=Only a title')).rejects.toThrow('exit 1');

		expect(err.join('\n')).toContain('--prompt');
		expect(createTmCore).not.toHaveBeenCalled();
	});

	it('refuses a tasks file other than the project tasks.json', async () => {
		await expect(run('--prompt=p', '--file=/tmp/other.json')).rejects.toThrow(
			'exit 1'
		);

		expect(err.join('\n')).toContain(
			'add-task writes only .taskgraph/tasks/tasks.json'
		);
		expect(add).not.toHaveBeenCalled();
	});

	it('reads a relative --file from the project root, not the current folder', async () => {
		await run('--prompt=p', '--file=.taskgraph/tasks/tasks.json');

		expect(add).toHaveBeenCalled();
	});

	it('prints a failure once with the hint for it and exits 1', async () => {
		add.mockRejectedValue(new Error('Reached maximum number of turns (6)'));

		await expect(run('--prompt=p')).rejects.toThrow('exit 1');

		const text = err.join('\n');
		expect(text).toContain('Reached maximum number of turns (6)');
		expect(text).toContain('Raise claudeCode.maxTurns');
	});
});
