/**
 * @fileoverview Releases before the move to @tm/core locked tasks.json with a
 * plain `tasks.json.lock` file; tm-core locks it with a `tasks.json.lock`
 * directory. An older release can still run on the same project (a global
 * install, an MCP server that wasn't restarted), so tm-core must wait while
 * that file is held.
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
	let env: NodeJS.ProcessEnv;

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const statuses = () =>
		JSON.parse(fs.readFileSync(tasksFile(), 'utf8')).master.tasks.map(
			(t: { status: string }) => t.status
		);

	const writer = (id: number, status: string) =>
		start(
			process.execPath,
			['--import', 'tsx', holdLock, tasksFile(), String(id), status],
			// --import tsx is looked up from the working directory
			{ cwd: repoRoot, env }
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-lock-interop-'));
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
	});

	it('tm-core waits while the older lock file is held', async () => {
		const lockFile = `${tasksFile()}.lock`;
		fs.writeFileSync(lockFile, '');

		const core = writer(2, 'done');
		await until(
			core,
			() => core.lines.includes('trying'),
			'the tm-core writer'
		);
		await pause(300);
		expect(core.hasExited()).toBe(false);
		expect(statuses()).toEqual(['pending', 'pending']);

		fs.rmSync(lockFile);
		expect(await core.exited).toBe(0);
		expect(core.stderr()).toBe('');
		expect(statuses()).toEqual(['pending', 'done']);
		expect(fs.readdirSync(path.dirname(tasksFile()))).toEqual(['tasks.json']);
	}, 60000);
});
