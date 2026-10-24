/**
 * @fileoverview The four dependency commands: what they print and their exit
 * codes. tm-core is faked at createTmCore; Commander and chalk are real.
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

describe('validate-dependencies and fix-dependencies', () => {
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
