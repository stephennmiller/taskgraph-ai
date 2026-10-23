/**
 * Project root order in the legacy MCP server's withNormalizedProjectRoot
 * (#339): an explicit projectRoot wins over TASKGRAPH_PROJECT_ROOT, as in the
 * CLI, and the variable still applies when a call passes no projectRoot or
 * passes a loop --parallel task worktree of that project.
 */
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withNormalizedProjectRoot } from '../../../../mcp-server/src/tools/utils.js';

const main = path.resolve('/projects/main');
const other = path.resolve('/projects/other');
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

const rootPassed = async (args: object, session: object = {}) => {
	const fn = vi.fn().mockResolvedValue({ content: [] });
	await withNormalizedProjectRoot(fn)(args, { log, session });
	return fn.mock.calls[0]?.[0]?.projectRoot;
};

describe('legacy withNormalizedProjectRoot project root', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('takes an explicit projectRoot over TASKGRAPH_PROJECT_ROOT', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);

		expect(await rootPassed({ projectRoot: other })).toBe(other);
	});

	it("takes an explicit projectRoot over the session's TASKGRAPH_PROJECT_ROOT", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(
			await rootPassed(
				{ projectRoot: other },
				{ env: { TASKGRAPH_PROJECT_ROOT: main } }
			)
		).toBe(other);
	});

	it('keeps a loop --parallel task worktree on the main project', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);
		const worktree = path.join(main, '.taskgraph', 'worktrees', 'task-3');

		expect(await rootPassed({ projectRoot: worktree })).toBe(main);
	});

	it('uses TASKGRAPH_PROJECT_ROOT when no projectRoot is passed', async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', main);

		expect(await rootPassed({}, { roots: [{ uri: `file://${other}` }] })).toBe(
			main
		);
	});

	it("uses the session's TASKGRAPH_PROJECT_ROOT when the process has none", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(
			await rootPassed({}, { env: { TASKGRAPH_PROJECT_ROOT: main } })
		).toBe(main);
	});

	it("falls back to the session's root folder", async () => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');

		expect(await rootPassed({}, { roots: [{ uri: `file://${other}` }] })).toBe(
			other
		);
	});
});
