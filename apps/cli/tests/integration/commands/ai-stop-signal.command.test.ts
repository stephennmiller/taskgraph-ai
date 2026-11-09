/**
 * @fileoverview SIGTERM to an AI command leaves no Claude running (#1121).
 * The Agent SDK stops the Claude it started only when the command exits, not
 * when a signal ends it, so each AI command exits on a stop signal. Run
 * against the built CLI with the fake `claude`, which never answers here.
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const alive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

// Windows has no SIGTERM to send, and its fake claude has a launcher between
describe.skipIf(!built || process.platform === 'win32')(
	'SIGTERM to an AI command (fake claude)',
	{ timeout: 120000 },
	() => {
		let project: string;
		let work: string;

		beforeEach(() => {
			project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-stop-'));
			work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-stop-work-'));
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
			fs.writeFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				JSON.stringify({
					master: {
						tasks: [
							{
								id: 1,
								title: 'Task 1',
								description: 'Task 1 description',
								details: '',
								testStrategy: '',
								status: 'pending',
								priority: 'medium',
								dependencies: [],
								subtasks: []
							}
						],
						metadata: { created: new Date().toISOString() }
					}
				})
			);
		});

		afterEach(() => {
			fs.rmSync(project, { recursive: true, force: true });
			fs.rmSync(work, { recursive: true, force: true });
		});

		it.each([
			['expand', ['expand', '1']],
			['analyze-complexity', ['analyze-complexity']],
			['research', ['research', 'what is a task']],
			['update', ['update', '1', '--prompt=add a detail']]
		])('%s exits 143 and stops its Claude', async (_, args) => {
			// The model never answers: nothing makes `never`
			const fake = installFakeClaude({
				projectDir: project,
				workDir: work,
				replies: [{ text: '', holdUntil: 'never' }]
			});
			const command = spawn(process.execPath, [binPath, ...args], {
				cwd: project,
				stdio: 'ignore',
				env: {
					...process.env,
					FORCE_COLOR: '0',
					TASKGRAPH_SKIP_AUTO_UPDATE: '1',
					...fake.env
				}
			});
			const ended = new Promise<number | null>((resolve) =>
				command.once('close', resolve)
			);
			try {
				await vi.waitFor(() => expect(readTrace(fake.dir)).toHaveLength(1), {
					timeout: 60000,
					interval: 100
				});
				const [claude] = readTrace(fake.dir);
				expect(alive(claude.pid)).toBe(true);

				command.kill('SIGTERM');

				expect(await ended).toBe(143);
				await vi.waitFor(() => expect(alive(claude.pid)).toBe(false), {
					timeout: 20000,
					interval: 100
				});
			} finally {
				command.kill('SIGKILL');
				for (const { pid } of readTrace(fake.dir)) {
					if (alive(pid)) process.kill(pid, 'SIGKILL');
				}
			}
		});
	}
);
