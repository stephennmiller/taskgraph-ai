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
const ids = Array.from({ length: TASK_COUNT }, (_, i) => i + 1);
// How long to wait for the MCP side's first save before starting the CLI side
const FIRST_MCP_SAVE_TIMEOUT_MS = 60000;

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
		const child = spawn(command, args, {
			...options,
			stdio: 'pipe',
			timeout: 110000,
			killSignal: 'SIGKILL'
		});
		let stdout = '';
		let stderr = '';
		child.stdout.on('data', (d) => (stdout += d));
		child.stderr.on('data', (d) => (stderr += d));
		child.on('close', (status) => resolve({ status, stdout, stderr }));
	});

/** Resolve once any of `ids` is saved as done, or after `timeoutMs` */
async function firstSave(file: string, ids: number[], timeoutMs: number) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const tasks = JSON.parse(fs.readFileSync(file, 'utf8')).master.tasks;
			if (ids.some((id) => tasks[id - 1]?.status === 'done')) return;
		} catch {
			// Read while a writer was replacing the file; try again
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}

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
		const init = spawnSync(
			process.execPath,
			[cliBin, 'init', '--yes', '--no-aliases', '--no-git'],
			{ cwd: dir, env, input: '', timeout: 60000 }
		);
		expect(init.status).toBe(0);
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
		// A second tag that no writer touches, to catch one that drops it
		const other = { tasks: [{ ...tasks[0], id: 1, title: 'Other tag task' }] };
		fs.writeFileSync(tasksFile(), JSON.stringify({ master: { tasks }, other }));
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

		// Odd tasks through the CLI, even tasks through the MCP server. The server
		// takes a while to boot, and the CLI now starts in well under that, so
		// the CLI side starts once the first MCP save lands. The other MCP saves
		// are still in flight, so the two sides write at the same time (#513).
		const mcpIds = ids.filter((id) => id % 2 === 0);
		const cliIds = ids.filter((id) => id % 2 === 1);
		const mcpRuns = mcpIds.map(viaMcp);
		await firstSave(tasksFile(), mcpIds, FIRST_MCP_SAVE_TIMEOUT_MS);
		const cliRuns = cliIds.map(viaCli);
		const [mcpResults, cliResults] = await Promise.all([
			Promise.all(mcpRuns),
			Promise.all(cliRuns)
		]);

		const failed = [...cliResults, ...mcpResults].filter((r) => r.status !== 0);
		expect(failed.map((r) => r.stderr || r.stdout)).toEqual([]);
		// The smoke script exits 0 even when the tool answers with an error
		const mcpErrors = mcpResults.filter(
			(r) => JSON.parse(r.stdout).calls[0].isError
		);
		expect(mcpErrors.map((r) => r.stdout)).toEqual([]);

		const saved = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
		const tasks = saved.master.tasks as {
			id: string;
			title: string;
			status: string;
			updatedAt: string;
		}[];
		expect(tasks.map((t) => [t.id, t.title, t.status])).toEqual(
			ids.map((id) => [String(id), `Task ${id}`, 'done'])
		);
		expect(saved.other.tasks[0]).toMatchObject({
			title: 'Other tag task',
			status: 'pending'
		});
		expect(fs.readdirSync(path.dirname(tasksFile()))).toEqual(['tasks.json']);

		// The two sides must really have overlapped: the first MCP save came
		// before the last CLI save
		const savedAt = (side: number[]) =>
			side.map((id) => Date.parse(tasks[id - 1].updatedAt));
		expect(Math.min(...savedAt(mcpIds))).toBeLessThan(
			Math.max(...savedAt(cliIds))
		);
	}, 120000);
});
