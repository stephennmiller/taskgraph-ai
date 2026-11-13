/**
 * @fileoverview `loop` on a project whose tasks are all done or cancelled:
 * one line, and nothing that leads up to a run (#1160)
 */

import { stripVTControlCharacters } from 'node:util';
import { type Mock, afterEach, beforeEach, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@tm/core')>();
	return { ...actual, createTmCore: vi.fn() };
});
vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: vi.fn()
}));
vi.mock('../utils/error-handler.js', () => ({
	displayError: vi.fn(),
	printError: vi.fn()
}));
vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: vi.fn().mockReturnValue('/test/project')
}));

import { createTmCore } from '@tm/core';
import { displayError, printError } from '../utils/error-handler.js';
import { getProjectRoot } from '../utils/project-root.js';
import { LoopCommand } from './loop.command.js';

const loop = {
	run: vi.fn(),
	nothingLeft: vi.fn(),
	isTrusted: vi.fn(),
	checkSandboxAuth: vi.fn(),
	runInteractiveAuth: vi.fn(),
	resolveIterations: () => 10,
	isPreset: () => true,
	isTaskPreset: () => true,
	resolveTask: async (id: string) => ({ id, title: 'Users table' })
};
let log: Mock;

beforeEach(() => {
	vi.clearAllMocks();
	process.exitCode = undefined;
	vi.mocked(getProjectRoot).mockReturnValue('/test/project');
	log = vi.spyOn(console, 'log').mockImplementation(() => {}) as never;
	loop.nothingLeft.mockResolvedValue(true);
	// A run would need approval, and its sandbox a sign-in
	loop.isTrusted.mockReturnValue(false);
	loop.checkSandboxAuth.mockReturnValue({ ready: false });
	loop.run.mockResolvedValue({
		iterations: [],
		totalIterations: 1,
		tasksCompleted: 0,
		finalStatus: 'max_iterations'
	});
	vi.mocked(createTmCore).mockResolvedValue({
		projectPath: '/test/project',
		loop,
		tasks: { getPickableCount: async () => 0, getNext: async () => null },
		config: { getActiveTag: () => 'master' }
	} as never);
});

afterEach(() => {
	vi.restoreAllMocks();
	process.exitCode = undefined;
});

const execute = (options: Record<string, unknown>) =>
	(new LoopCommand() as any).execute(options);

it.each([
	['without approval', {}],
	['with --sandbox', { sandbox: true }],
	['with --trust', { trust: true }]
])('prints only the all-done line %s', async (_name, options) => {
	await execute(options);

	expect(
		log.mock.calls.map((c) => stripVTControlCharacters(String(c[0])))
	).toEqual(['✓ All tasks complete · nothing left to work on']);
	expect(loop.run).not.toHaveBeenCalled();
	expect(loop.runInteractiveAuth).not.toHaveBeenCalled();
	expect(printError).not.toHaveBeenCalled();
	expect(displayError).not.toHaveBeenCalled();
	expect(process.exitCode).toBeUndefined();
});

it('still runs a task pinned with --id', async () => {
	await execute({ trust: true, id: '1' });

	expect(loop.nothingLeft).not.toHaveBeenCalled();
	expect(loop.run).toHaveBeenCalled();
});

it('still shows the plan with --dry-run', async () => {
	const plan = vi.fn().mockResolvedValue({
		prompt: 'default',
		iterations: 10,
		tasks: [],
		picksOwnWork: false
	});
	Object.assign(loop, { plan });

	await execute({ dryRun: true });

	expect(plan).toHaveBeenCalled();
	expect(loop.nothingLeft).not.toHaveBeenCalled();
});
