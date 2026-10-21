/**
 * The dependency commands report a problem by throwing a coded
 * DependencyError. They never call process.exit, which would kill the MCP
 * server that runs them. Only tasks.json I/O is mocked.
 */

import { vi } from 'vitest';

const { readJSON, writeJSON } = vi.hoisted(() => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn()
}));

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON,
	writeJSON,
	log: vi.fn()
}));

import {
	addDependency,
	DependencyError,
	fixDependenciesCommand,
	removeDependency,
	validateDependenciesCommand
} from '../../../../../scripts/modules/dependency-manager.js';

const context = { projectRoot: '/project', tag: 'master' };

const task = (id, dependencies = [], subtasks) => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	...(subtasks ? { subtasks } : {})
});

describe('dependency commands report errors instead of exiting', () => {
	let exit;

	beforeEach(() => {
		vi.clearAllMocks();
		exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
	});
	afterEach(() => vi.restoreAllMocks());

	describe.each([
		[
			'validate-dependencies',
			() => validateDependenciesCommand('t.json', { context })
		],
		['fix-dependencies', () => fixDependenciesCommand('t.json', { context })],
		['add-dependency', () => addDependency('t.json', 1, 2, context)],
		['remove-dependency', () => removeDependency('t.json', 1, 2, context)]
	])('%s', (_name, run) => {
		it.each([
			['no tag data', null],
			['no tasks array', {}]
		])('throws NO_TASKS for %s', async (_case, data) => {
			readJSON.mockReturnValue(data);

			const error = await run().catch((e) => e);

			expect(error).toBeInstanceOf(DependencyError);
			expect(error.code).toBe('NO_TASKS');
			expect(error.message).toBe('No tasks yet');
			expect(error.data.hint).toContain('parse-prd');
			expect(exit).not.toHaveBeenCalled();
		});
	});

	it('fix-dependencies reports a failed write as FIX_FAILED', async () => {
		readJSON.mockReturnValue({ tasks: [task(1, [9])] });
		writeJSON.mockImplementation(() => {
			throw new Error('disk full');
		});

		const error = await fixDependenciesCommand('t.json', { context }).catch(
			(e) => e
		);

		expect(error).toBeInstanceOf(DependencyError);
		expect(error.code).toBe('FIX_FAILED');
		expect(error.message).toBe("Couldn't fix dependencies: disk full");
		expect(exit).not.toHaveBeenCalled();
	});

	it('add-dependency reports a missing task as TASK_NOT_FOUND', async () => {
		readJSON.mockReturnValue({ tasks: [task(1)] });

		await expect(addDependency('t.json', 1, 9, context)).rejects.toMatchObject({
			code: 'TASK_NOT_FOUND'
		});
		expect(exit).not.toHaveBeenCalled();
	});

	it('add-dependency reports a self-dependency as SELF_DEPENDENCY', async () => {
		readJSON.mockReturnValue({
			tasks: [task(1, [], [{ id: 1, title: 'S', status: 'pending' }])]
		});
		await expect(
			addDependency('t.json', '1.1', '1.1', context)
		).rejects.toMatchObject({ code: 'SELF_DEPENDENCY' });
		expect(exit).not.toHaveBeenCalled();
	});

	it('add-dependency reports a loop as CIRCULAR_DEPENDENCY with a hint', async () => {
		readJSON.mockReturnValue({ tasks: [task(1, [2]), task(2)] });

		const error = await addDependency('t.json', 2, 1, context).catch((e) => e);

		expect(error.code).toBe('CIRCULAR_DEPENDENCY');
		expect(error.data.hint).toContain('graph');
		expect(writeJSON).not.toHaveBeenCalled();
		expect(exit).not.toHaveBeenCalled();
	});
});
