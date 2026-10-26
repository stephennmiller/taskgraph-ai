/**
 * @fileoverview `expand --all` expands three tasks at once (#251). The fake
 * `claude` holds its first three answers until the test releases them, so
 * the test sees three calls waiting on the model together, then checks every
 * task kept its subtasks: parallel saves must not undo each other.
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	installFakeClaude,
	readTrace
} from '../../fakes/install-fake-claude.mjs';
import { getCliBinPath } from '../../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

const TASK_COUNT = 5;

interface Finished {
	status: number | null;
	stdout: string;
	stderr: string;
}

describe.skipIf(!built)(
	'expand --all',
	() => {
		let project: string;
		let work: string;
		let env: NodeJS.ProcessEnv;
		let fakeDir: string;

		const readTasks = (): { id: number; subtasks: { id: number }[] }[] =>
			JSON.parse(
				fs.readFileSync(
					path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
					'utf8'
				)
			).master.tasks;

		const startExpandAll = () =>
			new Promise<Finished>((resolve) => {
				const child = spawn(
					process.execPath,
					// One: the fake answers with one subtask (#721)
					[binPath, 'expand', '--all', '--num=1'],
					{
						cwd: project,
						env,
						stdio: 'pipe',
						timeout: 200000,
						killSignal: 'SIGKILL'
					}
				);
				let stdout = '';
				let stderr = '';
				child.stdout.on('data', (d) => (stdout += d));
				child.stderr.on('data', (d) => (stderr += d));
				child.on('close', (status) => resolve({ status, stdout, stderr }));
			});

		const waitForCalls = async (count: number) => {
			const started = Date.now();
			while (readTrace(fakeDir).length < count) {
				if (Date.now() - started > 90000) {
					throw new Error(
						`only ${readTrace(fakeDir).length} of ${count} model calls started`
					);
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		};

		beforeEach(() => {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-all-'));
			work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-all-work-'));
			const init = spawnSync(
				process.execPath,
				[binPath, 'init', '--yes', '--no-aliases', '--no-git'],
				{
					cwd: project,
					encoding: 'utf8',
					input: '',
					env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
				}
			);
			expect(init.status, init.stderr).toBe(0);

			const tasks = Array.from({ length: TASK_COUNT }, (_, i) => ({
				id: i + 1,
				title: `Task ${i + 1}`,
				description: `Task ${i + 1} description`,
				details: '',
				testStrategy: '',
				status: 'pending',
				priority: 'medium',
				dependencies: [],
				subtasks: []
			}));
			fs.writeFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				JSON.stringify({ master: { tasks, metadata: {} } }, null, 2)
			);

			// The first three calls wait for the release file; the rest answer at once
			const fake = installFakeClaude({
				projectDir: project,
				workDir: work,
				replies: [
					{ holdUntil: 'release' },
					{ holdUntil: 'release' },
					{ holdUntil: 'release' }
				]
			});
			fakeDir = fake.dir;
			env = {
				...process.env,
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				COLUMNS: '80',
				...fake.env
			};
		});

		afterEach(() => {
			fs.rmSync(project, { recursive: true, force: true });
			fs.rmSync(work, { recursive: true, force: true });
		});

		it("expands three tasks at once and keeps every task's subtasks", async () => {
			const run = startExpandAll();

			await waitForCalls(3);
			// A fourth call waits until one of the three finishes
			await new Promise((resolve) => setTimeout(resolve, 500));
			expect(readTrace(fakeDir)).toHaveLength(3);
			fs.writeFileSync(path.join(fakeDir, 'release'), 'go');
			const result = await run;

			expect(result.status, result.stderr).toBe(0);
			expect(readTrace(fakeDir)).toHaveLength(TASK_COUNT);
			for (const task of readTasks()) {
				expect(task.subtasks.length, `task ${task.id}`).toBeGreaterThan(0);
			}
			const out = stripVTControlCharacters(result.stdout);
			expect(out).toContain(`✓ Expanded ${TASK_COUNT} tasks`);
			// One usage line for the whole run
			expect(out.match(/tokens \(/g)).toHaveLength(1);
		});
	},
	240000
);
