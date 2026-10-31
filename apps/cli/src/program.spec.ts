/**
 * `taskgraph --help` prints the hand-written HELP_GROUPS list, not the
 * registered commands, so a new command can go missing from it silently, as
 * loop, move, lang, scope-up, scope-down and github did (#219, #364). This
 * checks the list against the built Commander program.
 *
 * The update-check tests mock the installer. A non-terminal run skips the
 * check. A terminal run only notifies, unless the user opted in.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const autoUpdate = vi.hoisted(() => ({
	checkForUpdate: vi.fn(),
	displayUpgradeNotification: vi.fn(),
	performAutoUpdate: vi.fn(),
	restartWithNewVersion: vi.fn()
}));

vi.mock('./utils/auto-update/index.js', () => autoUpdate);

import { runCLI, setupCLI } from './program.js';
import { HELP_GROUPS } from './ui/formatters/help-formatters.js';

// Visible commands left out on purpose; see the HELP_GROUPS comment
const NOT_IN_HELP = new Set([
	'prime', // for agents, named in the footer
	'help',
	'update-subtask', // help points at `note` instead (#245)
	// the old per-tag commands that `tags <…>` replaces
	'add-tag',
	'delete-tag',
	'use-tag',
	'rename-tag',
	'copy-tag'
]);

const program = setupCLI();
const visible = program
	.createHelp()
	.visibleCommands(program)
	.map((c) => c.name());
// A row's name is the command plus an optional `<sub|…>` hint
const rows = HELP_GROUPS.flatMap((g) =>
	g.commands.map((r) => r.name.split(' ')[0])
);

describe('--help rows', () => {
	it('has a row for every visible command', () => {
		const missing = visible.filter(
			(name) => !NOT_IN_HELP.has(name) && !rows.includes(name)
		);
		expect(missing).toEqual([]);
	});

	it('names only registered commands', () => {
		expect(rows.filter((name) => !visible.includes(name))).toEqual([]);
	});

	it('excludes only commands that exist', () => {
		// Keeps the exclusion list from outliving a removed command
		expect([...NOT_IN_HELP].filter((n) => !visible.includes(n))).toEqual([]);
	});
});

describe('setupCLI', () => {
	const originalVersion = process.env.TM_PUBLIC_VERSION;

	afterEach(() => {
		if (originalVersion === undefined) delete process.env.TM_PUBLIC_VERSION;
		else process.env.TM_PUBLIC_VERSION = originalVersion;
	});

	it('is named taskgraph', () => {
		expect(program.name()).toBe('taskgraph');
	});

	it('reports the build-time version', () => {
		process.env.TM_PUBLIC_VERSION = '1.2.3';
		expect(setupCLI().version()).toBe('1.2.3');
	});

	it('reports unknown without a build-time version', () => {
		delete process.env.TM_PUBLIC_VERSION;
		expect(setupCLI().version()).toBe('unknown');
	});
});

describe('help <command> (#835)', () => {
	// Commander writes help and parse errors to the streams; printError uses
	// console.error
	function run(args: string[]) {
		const stdout = vi
			.spyOn(process.stdout, 'write')
			.mockImplementation(() => true);
		const stderr = vi
			.spyOn(process.stderr, 'write')
			.mockImplementation(() => true);
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const exit = vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code ?? 0}`);
		});
		try {
			expect(() => setupCLI().parse(args, { from: 'user' })).toThrow(/exit/);
			return {
				code: Number(String(exit.mock.calls[0][0] ?? 0)),
				out: stdout.mock.calls.flat().join(''),
				err: [...stderr.mock.calls, ...consoleError.mock.calls].flat().join('')
			};
		} finally {
			stdout.mockRestore();
			stderr.mockRestore();
			consoleError.mockRestore();
			exit.mockRestore();
		}
	}

	it('help tags shows the help for tags', () => {
		const { code, out } = run(['help', 'tags']);
		expect(code).toBe(0);
		expect(out).toContain('Usage: taskgraph tags');
	});

	it('help tags use shows the help for tags use', () => {
		const { code, out } = run(['help', 'tags', 'use']);
		expect(code).toBe(0);
		expect(out).toContain('tags use [options] <name>');
	});

	it('help with an unknown command fails with a hint', () => {
		const { code, err } = run(['help', 'nope']);
		expect(code).toBe(1);
		expect(err).toContain("Unknown command 'nope'");
		expect(err).toContain('taskgraph --help');
	});

	it('help with an unknown subcommand points at its parent', () => {
		const { code, err } = run(['help', 'tags', 'nope']);
		expect(code).toBe(1);
		expect(err).toContain("Unknown command 'tags nope'");
		expect(err).toContain('taskgraph tags --help');
	});

	it('quotes only the path up to the first unknown name', () => {
		const { code, err } = run(['help', 'nope', 'tags']);
		expect(code).toBe(1);
		expect(err).toContain("Unknown command 'nope'");
	});
});

const updateAvailable = {
	currentVersion: '1.0.0',
	latestVersion: '1.1.0',
	needsUpdate: true,
	highlights: [] as string[]
};

describe('runCLI update check', () => {
	const saved = { ...process.env };
	const savedTTY = process.stdin.isTTY;
	let home: string;

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cli-home-'));
		process.env = { ...saved, HOME: home, NODE_ENV: 'production' };
		delete process.env.CI;
		delete process.env.TASKGRAPH_SKIP_AUTO_UPDATE;
		delete process.env.TASKGRAPH_AUTO_UPDATE;
		delete process.env.TASKGRAPH_LOOP_CHILD;
		delete process.env.TASKGRAPH_PARALLEL_WORKER;
		process.stdin.isTTY = true;
		autoUpdate.checkForUpdate.mockReset();
		autoUpdate.displayUpgradeNotification.mockReset();
		autoUpdate.performAutoUpdate.mockReset();
		autoUpdate.restartWithNewVersion.mockReset();
		autoUpdate.checkForUpdate.mockResolvedValue(updateAvailable);
		autoUpdate.performAutoUpdate.mockResolvedValue(false);
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`exit ${code ?? 0}`);
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		process.env = { ...saved };
		process.stdin.isTTY = savedTTY;
		process.exitCode = undefined;
		fs.rmSync(home, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('skips the update check when stdin is not a terminal', async () => {
		process.stdin.isTTY = false;

		await expect(runCLI(['node', 'taskgraph', 'help'])).rejects.toThrow(/exit/);

		expect(autoUpdate.checkForUpdate).not.toHaveBeenCalled();
		expect(autoUpdate.performAutoUpdate).not.toHaveBeenCalled();
	});

	it('notifies and does not install by default', async () => {
		await expect(runCLI(['node', 'taskgraph', 'help'])).rejects.toThrow(/exit/);

		expect(autoUpdate.checkForUpdate).toHaveBeenCalledTimes(1);
		expect(autoUpdate.displayUpgradeNotification).toHaveBeenCalledWith(
			'1.0.0',
			'1.1.0',
			[],
			{ hint: true }
		);
		expect(autoUpdate.performAutoUpdate).not.toHaveBeenCalled();
	});

	it('installs when TASKGRAPH_AUTO_UPDATE=install', async () => {
		process.env.TASKGRAPH_AUTO_UPDATE = 'install';

		await expect(runCLI(['node', 'taskgraph', 'help'])).rejects.toThrow(/exit/);

		expect(autoUpdate.performAutoUpdate).toHaveBeenCalledWith(
			'1.1.0',
			expect.objectContaining({ argv: ['node', 'taskgraph', 'help'] })
		);
		expect(autoUpdate.displayUpgradeNotification).toHaveBeenCalledWith(
			'1.0.0',
			'1.1.0',
			[],
			{ hint: false }
		);
	});

	it('installs when ~/.taskgraph/auto-update.json opts in', async () => {
		fs.mkdirSync(path.join(home, '.taskgraph'));
		fs.writeFileSync(
			path.join(home, '.taskgraph', 'auto-update.json'),
			JSON.stringify({ autoUpdate: 'install' })
		);

		await expect(runCLI(['node', 'taskgraph', 'help'])).rejects.toThrow(/exit/);

		expect(autoUpdate.performAutoUpdate).toHaveBeenCalledWith(
			'1.1.0',
			expect.anything()
		);
	});

	it('installs when the command is upgrade', async () => {
		autoUpdate.performAutoUpdate.mockResolvedValue(true);

		await runCLI(['node', 'taskgraph', 'upgrade']);

		expect(autoUpdate.performAutoUpdate).toHaveBeenCalledWith('1.1.0', {
			explicit: true
		});
		expect(autoUpdate.checkForUpdate).toHaveBeenCalledTimes(1);
		// A restart would only run `upgrade` again on the new version
		expect(autoUpdate.restartWithNewVersion).not.toHaveBeenCalled();
	});

	it('exits 1 when upgrade runs in a process loop started', async () => {
		process.env.TASKGRAPH_LOOP_CHILD = '1';

		await runCLI(['node', 'taskgraph', 'upgrade']);

		expect(autoUpdate.performAutoUpdate).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	});
});
