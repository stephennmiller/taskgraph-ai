/**
 * @fileoverview The older scripts lock tasks.json with a plain
 * `tasks.json.lock` file; tm-core locks it with a `tasks.json.lock` directory.
 * Commands move from one to the other one at a time, so for a while both are
 * in use. Each side must wait while the other holds its lock, and neither
 * side's change may be lost.
 *
 * @integration
 */

import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const holdLock = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../helpers/hold-lock.mjs'
);

const repoRoot = path.resolve(path.dirname(holdLock), '../../../..');

/** A started process: its output lines so far, and when it exits */
interface Running {
	child: ChildProcess;
	lines: string[];
	stderr: () => string;
	exited: Promise<number | null>;
	hasExited: () => boolean;
}

const start = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv }
): Running => {
	const child = spawn(command, args, { ...options, stdio: 'pipe' });
	const lines: string[] = [];
	let stderr = '';
	let done = false;
	createInterface({ input: child.stdout! }).on('line', (l) => lines.push(l));
	child.stderr!.on('data', (d) => (stderr += d));
	const exited = new Promise<number | null>((resolve) =>
		child.on('close', (code) => {
			done = true;
			resolve(code);
		})
	);
	return { child, lines, stderr: () => stderr, exited, hasExited: () => done };
};

const until = async (proc: Running, check: () => boolean, what: string) => {
	const end = Date.now() + 30000;
	while (!check()) {
		if (Date.now() > end || proc.hasExited()) {
			throw new Error(`gave up waiting for ${what}\n${proc.stderr()}`);
		}
		await new Promise((r) => setTimeout(r, 20));
	}
};

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('older lock file and tm-core lock directory', () => {
	let dir: string;
	let home: string;
	let env: NodeJS.ProcessEnv;
	let release: string;

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const statuses = () =>
		JSON.parse(fs.readFileSync(tasksFile(), 'utf8')).master.tasks.map(
			(t: { status: string }) => t.status
		);

	const holder = (
		mode: 'legacy' | 'tm-core',
		id: number,
		status: string,
		releaseFile: string
	) =>
		start(
			process.execPath,
			[
				'--import',
				'tsx',
				holdLock,
				mode,
				tasksFile(),
				String(id),
				status,
				releaseFile
			],
			// --import tsx is looked up from the working directory
			{ cwd: repoRoot, env }
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lock-interop-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lock-interop-home-'));
		release = path.join(home, 'release');
		env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };
		const tasks = [1, 2].map((id) => ({
			id,
			title: `Task ${id}`,
			status: 'pending'
		}));
		fs.mkdirSync(path.dirname(tasksFile()), { recursive: true });
		fs.writeFileSync(tasksFile(), JSON.stringify({ master: { tasks } }));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('tm-core waits while the older lock file is held', async () => {
		const legacy = holder('legacy', 1, 'in-progress', release);
		await until(legacy, () => legacy.lines.includes('held'), 'the older lock');

		const core = holder('tm-core', 2, 'done', 'none');
		await until(
			core,
			() => core.lines.includes('trying'),
			'the tm-core writer'
		);
		await pause(300);
		expect(core.hasExited()).toBe(false);
		expect(statuses()).toEqual(['pending', 'pending']);

		fs.writeFileSync(release, '');
		expect([await legacy.exited, await core.exited]).toEqual([0, 0]);
		expect(core.stderr()).toBe('');
		expect(statuses()).toEqual(['in-progress', 'done']);
		expect(fs.readdirSync(path.dirname(tasksFile()))).toEqual(['tasks.json']);
	}, 60000);

	it('the older code waits while the tm-core lock directory is held', async () => {
		const core = holder('tm-core', 1, 'in-progress', release);
		await until(core, () => core.lines.includes('held'), 'the tm-core lock');

		const legacy = holder('legacy', 2, 'done', 'none');
		await until(
			legacy,
			() => legacy.lines.includes('trying'),
			'the older writer'
		);
		await pause(300);
		expect(legacy.hasExited()).toBe(false);
		expect(statuses()).toEqual(['pending', 'pending']);

		fs.writeFileSync(release, '');
		expect([await core.exited, await legacy.exited]).toEqual([0, 0]);
		expect(legacy.stderr()).toBe('');
		expect(statuses()).toEqual(['in-progress', 'done']);
		expect(fs.readdirSync(path.dirname(tasksFile()))).toEqual(['tasks.json']);
	}, 60000);
});
