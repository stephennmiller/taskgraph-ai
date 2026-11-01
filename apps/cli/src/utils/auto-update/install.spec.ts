import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('child_process')>();
	return { ...actual, spawn };
});
vi.mock('../../ui/spinner.js', () => ({
	createSpinner: () => ({
		start() {
			return { succeed() {}, fail() {}, text: '' };
		}
	})
}));

import { performAutoUpdate } from './install.js';

function fakeNpm(exitCode: number) {
	const child: any = new EventEmitter();
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	setImmediate(() => child.emit('close', exitCode));
	return child;
}

describe('performAutoUpdate', () => {
	const saved = { ...process.env };
	const savedArgv = process.argv;
	const savedTTY = process.stdin.isTTY;
	let home: string;

	beforeEach(() => {
		delete process.env.CI;
		delete process.env.TASKGRAPH_SKIP_AUTO_UPDATE;
		delete process.env.TASKGRAPH_LOOP_CHILD;
		delete process.env.TASKGRAPH_PARALLEL_WORKER;
		process.env.NODE_ENV = 'production';
		process.stdin.isTTY = true;
		process.argv = ['node', 'taskgraph', 'list'];
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-update-'));
		vi.spyOn(console, 'log').mockImplementation(() => {});
		spawn.mockReset();
	});

	afterEach(() => {
		process.env = { ...saved };
		process.argv = savedArgv;
		process.stdin.isTTY = savedTTY;
		fs.rmSync(home, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	it('installs through npm so npm checks the package integrity', async () => {
		spawn.mockReturnValue(fakeNpm(0));

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(true);

		expect(spawn).toHaveBeenCalledTimes(1);
		const [cmd, args] = spawn.mock.calls[0];
		expect(cmd).toBe('npm');
		expect(args.slice(0, 3)).toEqual(['install', '-g', 'taskgraph-ai@1.2.3']);
	});

	it('starts npm.cmd through the shell on Windows, as one fixed command', async () => {
		const platform = process.platform;
		Object.defineProperty(process, 'platform', { value: 'win32' });
		spawn.mockReturnValue(fakeNpm(0));

		try {
			await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(true);
		} finally {
			Object.defineProperty(process, 'platform', { value: platform });
		}

		const [cmd, args, options] = spawn.mock.calls[0];
		expect(cmd).toBe(
			'npm install -g taskgraph-ai@1.2.3 --no-fund --no-audit --loglevel=warn'
		);
		expect(args).toEqual([]);
		expect(options.shell).toBe(true);
	});

	it('refuses a version that is not semver, so no shell sees it', async () => {
		await expect(performAutoUpdate('1.2.3 & calc', { home })).resolves.toBe(
			false
		);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('reports failure when npm exits non-zero', async () => {
		spawn.mockReturnValue(fakeNpm(1));

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
	});

	it('does nothing in CI', async () => {
		process.env.CI = '1';

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('does nothing when stdin is not a terminal', async () => {
		process.stdin.isTTY = false;

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('does nothing for --json output', async () => {
		process.argv = ['node', 'taskgraph', 'list', '--json'];

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('does nothing when started by loop', async () => {
		process.env.TASKGRAPH_LOOP_CHILD = '1';

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('does nothing when started by a parallel worker', async () => {
		process.env.TASKGRAPH_PARALLEL_WORKER = '1';

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it('installs once when two calls overlap', async () => {
		let release: (code: number) => void = () => {};
		const held = new Promise<number>((resolve) => {
			release = resolve;
		});
		spawn.mockImplementation(() => {
			const child: any = new EventEmitter();
			child.stdout = new EventEmitter();
			child.stderr = new EventEmitter();
			held.then((code) => child.emit('close', code));
			return child;
		});

		const first = performAutoUpdate('1.2.3', { home });
		const second = await performAutoUpdate('1.2.3', { home });

		expect(second).toBe(false);
		expect(spawn).toHaveBeenCalledTimes(1);
		release(0);
		await expect(first).resolves.toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it('reclaims a stale lock and installs', async () => {
		const file = path.join(home, '.taskgraph', 'update.lock');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify({ pid: process.pid, startedAt: 0 }));
		spawn.mockReturnValue(fakeNpm(0));

		await expect(performAutoUpdate('1.2.3', { home })).resolves.toBe(true);
		expect(spawn).toHaveBeenCalledTimes(1);
	});
});
