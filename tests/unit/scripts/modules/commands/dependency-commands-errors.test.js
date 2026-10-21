/**
 * The dependency CLI commands print a DependencyError with printError and
 * exit 1, instead of the core functions exiting. Commander, the command
 * registration and DependencyError are real; the core functions, the project
 * lookup and printError are mocked.
 */
import { vi } from 'vitest';

// Load ui.js first: commands.js -> @tm/cli -> ... -> ui.js -> @tm/cli is an
// import cycle that Vitest only resolves when ui.js is the entry point.
import '../../../../../scripts/modules/ui.js';

const mocks = vi.hoisted(() => ({
	printError: vi.fn(),
	validate: vi.fn(),
	fix: vi.fn(),
	add: vi.fn(),
	remove: vi.fn()
}));

vi.mock('@tm/cli', async (importOriginal) => ({
	...(await importOriginal()),
	printError: mocks.printError
}));

vi.mock('../../../../../src/taskgraph.js', () => ({
	initTaskGraph: () => ({
		getCurrentTag: () => 'master',
		getTasksPath: () => '/project/.taskgraph/tasks/tasks.json',
		getProjectRoot: () => '/project'
	})
}));

vi.mock(
	'../../../../../scripts/modules/dependency-manager.js',
	async (importOriginal) => ({
		...(await importOriginal()),
		validateDependenciesCommand: mocks.validate,
		fixDependenciesCommand: mocks.fix,
		addDependency: mocks.add,
		removeDependency: mocks.remove
	})
);

import { Command } from 'commander';
import { registerCommands } from '../../../../../scripts/modules/commands.js';
import { DependencyError } from '../../../../../scripts/modules/dependency-manager.js';

const noTasks = () =>
	new DependencyError('NO_TASKS', 'No tasks yet', { hint: 'Create some' });

describe('dependency CLI commands on a DependencyError', () => {
	let program;
	let exit;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, 'log').mockImplementation(() => {});
		// A real exit never returns
		exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code}`);
		});
		program = new Command().exitOverride();
		registerCommands(program);
	});
	afterEach(() => vi.restoreAllMocks());

	it.each([
		['validate-dependencies', [], 'validate'],
		['fix-dependencies', [], 'fix'],
		['add-dependency', ['--id=1', '--depends-on=2'], 'add'],
		['remove-dependency', ['--id=1', '--depends-on=2'], 'remove']
	])('%s prints the error and exits 1', async (command, args, mock) => {
		mocks[mock].mockRejectedValue(noTasks());

		await expect(
			program.parseAsync(['node', 'taskgraph', command, ...args])
		).rejects.toThrow('exit 1');

		expect(mocks.printError).toHaveBeenCalledWith(
			'No tasks yet',
			'Create some'
		);
		expect(exit).toHaveBeenCalledWith(1);
	});

	it('rethrows an error that is not a DependencyError', async () => {
		mocks.validate.mockRejectedValue(new Error('boom'));

		await expect(
			program.parseAsync(['node', 'taskgraph', 'validate-dependencies'])
		).rejects.toThrow('boom');
		expect(mocks.printError).not.toHaveBeenCalled();
	});
});
