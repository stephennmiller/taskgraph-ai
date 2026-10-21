/**
 * MCP dependency tools return an error result when readJSON finds nothing (a
 * missing or unreadable tasks file). They used to end the server process. An
 * empty or unknown tag is not this case: readJSON returns an empty task list
 * for it. Only tasks.json I/O is mocked.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';

const { readJSON } = vi.hoisted(() => ({ readJSON: vi.fn() }));

vi.mock('../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON,
	writeJSON: vi.fn(),
	log: vi.fn()
}));

import { addDependencyDirect } from '../../../../mcp-server/src/core/direct-functions/add-dependency.js';
import { fixDependenciesDirect } from '../../../../mcp-server/src/core/direct-functions/fix-dependencies.js';
import { removeDependencyDirect } from '../../../../mcp-server/src/core/direct-functions/remove-dependency.js';
import { validateDependenciesDirect } from '../../../../mcp-server/src/core/direct-functions/validate-dependencies.js';

const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

describe('MCP dependency tools when readJSON returns nothing', () => {
	let dir;
	let tasksJsonPath;
	let exit;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-'));
		tasksJsonPath = path.join(dir, 'tasks.json');
		fs.writeFileSync(tasksJsonPath, '{}');
		readJSON.mockReturnValue(null);
		exit = vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
	});
	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it.each([
		['validate_dependencies', (args) => validateDependenciesDirect(args, log)],
		['fix_dependencies', (args) => fixDependenciesDirect(args, log)],
		[
			'add_dependency',
			(args) => addDependencyDirect({ ...args, id: '1', dependsOn: '2' }, log)
		],
		[
			'remove_dependency',
			(args) =>
				removeDependencyDirect({ ...args, id: '1', dependsOn: '2' }, log)
		]
	])(
		'%s returns the NO_TASKS error instead of exiting',
		async (_tool, call) => {
			const result = await call({
				tasksJsonPath,
				projectRoot: dir,
				tag: 'empty'
			});

			expect(result.success).toBe(false);
			expect(result.error).toEqual({
				code: 'NO_TASKS',
				message: 'No tasks yet'
			});
			expect(exit).not.toHaveBeenCalled();
		}
	);
});
