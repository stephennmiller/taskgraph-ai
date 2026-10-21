/**
 * The MCP dependency tools return an error result, with the code the core
 * function threw, for the mistakes that used to end the server: an unknown
 * task, a self-dependency, a loop, a failed fix. Nothing is mocked but the
 * logger: a real tasks.json is read by the real readJSON.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { addDependencyDirect } from '../../../../mcp-server/src/core/direct-functions/add-dependency.js';
import { fixDependenciesDirect } from '../../../../mcp-server/src/core/direct-functions/fix-dependencies.js';
import { removeDependencyDirect } from '../../../../mcp-server/src/core/direct-functions/remove-dependency.js';

const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const task = (id, dependencies = [], subtasks) => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	details: '',
	testStrategy: '',
	dependencies,
	subtasks: subtasks ?? []
});

describe('MCP dependency tools with a real tasks.json', () => {
	let dir;
	let tasksJsonPath;
	let exit;

	const write = (tasks) =>
		fs.writeFileSync(
			tasksJsonPath,
			JSON.stringify({ master: { tasks, metadata: {} } })
		);
	const args = (extra = {}) => ({
		tasksJsonPath,
		projectRoot: dir,
		tag: 'master',
		...extra
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-real-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksJsonPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('add_dependency on an unknown task returns TASK_NOT_FOUND', async () => {
		write([task(1)]);

		const result = await addDependencyDirect(
			args({ id: '1', dependsOn: '99' }),
			log
		);

		expect(result.success).toBe(false);
		expect(result.error).toEqual({
			code: 'TASK_NOT_FOUND',
			message: 'Task 99 not found'
		});
		expect(exit).not.toHaveBeenCalled();
	});

	it('add_dependency on a subtask of itself returns SELF_DEPENDENCY', async () => {
		write([task(1, [], [{ ...task(1), id: 1, title: 'S1' }])]);

		const result = await addDependencyDirect(
			args({ id: '1.1', dependsOn: '1.1' }),
			log
		);

		expect(result.error.code).toBe('SELF_DEPENDENCY');
		expect(exit).not.toHaveBeenCalled();
	});

	it('add_dependency that closes a loop returns CIRCULAR_DEPENDENCY', async () => {
		write([task(1, [2]), task(2)]);

		const result = await addDependencyDirect(
			args({ id: '2', dependsOn: '1' }),
			log
		);

		expect(result.error.code).toBe('CIRCULAR_DEPENDENCY');
		expect(exit).not.toHaveBeenCalled();
	});

	it('remove_dependency from an unknown task returns TASK_NOT_FOUND', async () => {
		write([task(1)]);

		const result = await removeDependencyDirect(
			args({ id: '9', dependsOn: '1' }),
			log
		);

		expect(result.error.code).toBe('TASK_NOT_FOUND');
		expect(exit).not.toHaveBeenCalled();
	});

	it('fix_dependencies returns FIX_FAILED when the fix cannot be saved', async () => {
		write([task(1, [9])]);
		vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
			throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
		});

		const result = await fixDependenciesDirect(args(), log);

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('FIX_FAILED');
	});

	it('an I/O error code does not leak as the MCP error code', async () => {
		write([task(1), task(2)]);
		vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
			throw Object.assign(new Error('no space'), { code: 'ENOSPC' });
		});

		const result = await addDependencyDirect(
			args({ id: '2', dependsOn: '1' }),
			log
		);

		expect(result.success).toBe(false);
		expect(result.error.code).toBe('CORE_FUNCTION_ERROR');
	});
});
