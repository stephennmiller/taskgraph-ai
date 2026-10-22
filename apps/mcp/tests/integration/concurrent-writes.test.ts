/**
 * @fileoverview The CLI and the MCP server write the same tasks.json. When
 * both save at once, every change must survive: no lost update, no broken
 * file, no lock left behind.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../..');
const cliBin = path.join(repoRoot, 'dist', 'taskgraph.js');
const smokeScript = path.resolve(__dirname, '../smoke/mcp-stdio.smoke.mjs');

const TASK_COUNT = 12;

interface Finished {
	status: number | null;
	stdout: string;
	stderr: string;
}

/** Run a process without blocking, so several run at the same time */
const runAsync = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv }
) =>
	new Promise<Finished>((resolve) => {
		const child = spawn(command, args, { ...options, stdio: 'pipe' });
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.on('close', (status) => resolve({ status, stdout, stderr }));
	});

describe('CLI and MCP server writing at the same time', () => {
	let dir: string;
	let home: string;
	let env: NodeJS.ProcessEnv;

	const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

	beforeEach(() => {
		if (!fs.existsSync(cliBin)) {
			throw new Error(`${cliBin} not found; run npm run build first`);
		}
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-concurrent-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-concurrent-home-'));
		env = {
			...process.env,
			HOME: home,
			FORCE_COLOR: '0',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1'
		};
		spawnSync(
			process.execPath,
			[cliBin, 'init', '--yes', '--no-aliases', '--no-git'],
			{ cwd: dir, env, input: '', timeout: 60000 }
		);
		const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
			id: i + 1,
			title: `Task ${i + 1}`,
			description: `Task ${i + 1}`,
			details: '',
			testStrategy: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			subtasks: []
		}));
		fs.writeFileSync(tasksFile(), JSON.stringify({ master: { tasks } }));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('keeps every status change when both sides save together', async () => {
		const viaCli = (id: number) =>
			runAsync(
				process.execPath,
				[cliBin, 'set-status', `--id=${id}`, '--status=done'],
				{ cwd: dir, env }
			);
		const viaMcp = (id: number) =>
			runAsync(
				process.execPath,
				[
					smokeScript,
					'--call',
					'set_task_status',
					'--args',
					JSON.stringify({
						id: String(id),
						status: 'done',
						projectRoot: dir
					}),
					'--timeout',
					'60000'
				],
				{ cwd: dir, env }
			);

		// Odd tasks through the CLI, even tasks through the MCP server
		const results = await Promise.all(
			Array.from({ length: TASK_COUNT }, (_, i) =>
				(i + 1) % 2 === 1 ? viaCli(i + 1) : viaMcp(i + 1)
			)
		);

		const failed = results.filter((r) => r.status !== 0);
		expect(failed.map((r) => r.stderr || r.stdout)).toEqual([]);

		const saved = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
		expect(saved.master.tasks.map((t: { status: string }) => t.status)).toEqual(
			Array(TASK_COUNT).fill('done')
		);
		expect(fs.existsSync(`${tasksFile()}.lock`)).toBe(false);
	}, 120000);
});
