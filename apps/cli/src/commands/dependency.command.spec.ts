/**
 * @fileoverview `depend`, `fix-dependencies [--check]` and their hidden
 * aliases: what they print and their exit codes. tm-core is faked at createTmCore; Commander and chalk are real.
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

import { createTmCore } from '@tm/core';
import {
	AddDependencyCommand,
	DependCommand,
	FixDependenciesCommand,
	RemoveDependencyCommand,
	ValidateDependenciesCommand
} from './dependency.command.js';

const tasks = {
	addDependency: vi.fn(),
	removeDependency: vi.fn(),
	validateDependencies: vi.fn(),
	fixDependencies: vi.fn()
};
const counts = { taskCount: 2, subtaskCount: 0, dependencyCount: 1 };

function run(...args: string[]): Promise<unknown> {
	const program = new Command().exitOverride();
	for (const command of [
		DependCommand,
		AddDependencyCommand,
		RemoveDependencyCommand,
		ValidateDependenciesCommand,
		FixDependenciesCommand
	]) {
		command.register(program);
	}
	return program.parseAsync([...args, '-p', process.cwd()], { from: 'user' });
}

const printed = () =>
	vi
		.mocked(console.log)
		.mock.calls.map((call) => call.join(' '))
		.join('\n');

beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.mocked(createTmCore).mockResolvedValue({
		tasks,
		projectPath: process.cwd(),
		config: { getActiveTag: () => 'master' },
		close: vi.fn()
	} as any);
});

afterEach(() => {
	process.exitCode = undefined;
	vi.restoreAllMocks();
});

describe('add-dependency and remove-dependency', () => {
	it('passes the IDs, tag and type to tm-core and prints the change', async () => {
		tasks.addDependency.mockResolvedValue({
			changed: true,
			message: 'Task 3 now depends on task 1'
		});

		await run('add-dependency', '--id=3', '--depends-on=1', '--tag=dev');

		expect(tasks.addDependency).toHaveBeenCalledWith('3', '1', {
			tag: 'dev',
			type: undefined
		});
		expect(printed()).toContain('Task 3 now depends on task 1');
		expect(process.exitCode).toBeUndefined();
	});

	it('exits 1 when tm-core refuses the change', async () => {
		tasks.addDependency.mockRejectedValue(
			new Error("Task 2 can't depend on itself")
		);

		await run('add-dependency', '--id=2', '--depends-on=2');

		expect(process.exitCode).toBe(1);
	});

	it('a dependency that was not there is not an error', async () => {
		tasks.removeDependency.mockResolvedValue({
			removed: false,
			message: "Task 2 doesn't depend on task 5; nothing changed"
		});

		await run('remove-dependency', '--id=2', '--depends-on=5');

		expect(printed()).toContain('nothing changed');
		expect(process.exitCode).toBeUndefined();
	});
});

describe('depend (#882)', () => {
	it('takes the two IDs as arguments', async () => {
		tasks.addDependency.mockResolvedValue({ changed: true, message: 'ok' });

		await run('depend', '3', '1', '--type=related');

		expect(tasks.addDependency).toHaveBeenCalledWith('3', '1', {
			tag: undefined,
			type: 'related'
		});
	});

	it('removes with --remove, and still takes --id and --depends-on', async () => {
		tasks.removeDependency.mockResolvedValue({ removed: true, message: 'ok' });

		await run('depend', '--id=3', '--depends-on=1', '--remove');

		expect(tasks.removeDependency).toHaveBeenCalledWith('3', '1', {
			tag: undefined
		});
		expect(tasks.addDependency).not.toHaveBeenCalled();
	});

	it('exits 1 before tm-core when an ID is missing', async () => {
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('exit');
		});

		await expect(run('depend', '3')).rejects.toThrow('exit');

		expect(tasks.addDependency).not.toHaveBeenCalled();
	});

	it.each([[['3', '--depends-on=1']], [['--id=3', '1']]])(
		'refuses IDs given both ways (%j), changing nothing',
		async (args) => {
			vi.spyOn(process, 'exit').mockImplementation(() => {
				throw new Error('exit');
			});

			await expect(run('depend', ...args)).rejects.toThrow('exit');

			expect(vi.mocked(console.error).mock.calls.join('\n')).toContain(
				'not both'
			);
			expect(tasks.addDependency).not.toHaveBeenCalled();
		}
	);

	it('hides the old names from help, which still run', () => {
		const program = new Command();
		for (const command of [
			DependCommand,
			AddDependencyCommand,
			RemoveDependencyCommand,
			ValidateDependenciesCommand,
			FixDependenciesCommand
		]) {
			command.register(program);
		}

		expect(
			program
				.createHelp()
				.visibleCommands(program)
				.map((c) => c.name())
		).toEqual(['depend', 'fix-dependencies', 'help']);
	});
});

const problem = {
	valid: false,
	issues: [
		{
			type: 'missing',
			taskId: 2,
			dependencyId: 99,
			message: 'Task 2 depends on task 99, which does not exist'
		}
	],
	...counts,
	prdCoverage: null,
	tasksPath: '/p/.taskgraph/tasks/tasks.json'
};

describe('fix-dependencies [--check] and validate-dependencies', () => {
	it('--check reports without fixing, and exits 1 on a problem', async () => {
		tasks.validateDependencies.mockResolvedValue(problem);

		await run('fix-dependencies', '--check');

		expect(tasks.fixDependencies).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});

	it('validate exits 1 when it finds a problem', async () => {
		tasks.validateDependencies.mockResolvedValue({
			valid: false,
			issues: [
				{
					type: 'missing',
					taskId: 2,
					dependencyId: 99,
					message: 'Task 2 depends on task 99, which does not exist'
				}
			],
			...counts,
			prdCoverage: null,
			tasksPath: '/p/.taskgraph/tasks/tasks.json'
		});

		await run('validate-dependencies');

		expect(process.exitCode).toBe(1);
	});

	it('fix exits 0 once nothing is left, 1 while a loop remains', async () => {
		const fixed = {
			fixes: [],
			remaining: [],
			changed: false,
			...counts,
			tag: 'master',
			tasksPath: '/p/.taskgraph/tasks/tasks.json'
		};
		tasks.fixDependencies.mockResolvedValue(fixed);

		await run('fix-dependencies');
		expect(process.exitCode).toBeUndefined();

		tasks.fixDependencies.mockResolvedValue({
			...fixed,
			remaining: [{ type: 'circular', taskId: '2', message: 'loop' }]
		});
		await run('fix-dependencies');
		expect(process.exitCode).toBe(1);
	});
});
