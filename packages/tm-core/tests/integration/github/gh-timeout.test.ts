/**
 * @fileoverview A `gh` that never answers must not hang push, pull or import
 * (#814). A stub `gh` on PATH sleeps; the client kills it after a short
 * timeout and the command fails with a hint, leaving tasks.json untouched.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GhCliClient } from '../../../src/modules/github/adapters/gh-cli-client.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';
import { REPO, makeTask } from './fake-github.js';

const isAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe.skipIf(process.platform === 'win32')('gh timeout', () => {
	let projectDir: string;
	let tasksFile: string;
	let pidFile: string;
	let domain: GitHubDomain;
	const originalPath = process.env.PATH;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-timeout-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		await seedTasks(new FileStorage(projectDir), [makeTask('1')], 'master');
		tasksFile = path.join(tgDir, 'tasks', 'tasks.json');

		// The sleep is a grandchild holding gh's stdout open, like a stuck helper
		pidFile = path.join(projectDir, 'gh.pids');
		const bin = path.join(projectDir, 'bin');
		fs.mkdirSync(bin);
		fs.writeFileSync(
			path.join(bin, 'gh'),
			`#!/bin/sh\nsleep 30 &\necho "$$ $!" > "${pidFile}"\nwait\n`,
			{ mode: 0o755 }
		);
		process.env.PATH = `${bin}${path.delimiter}${originalPath}`;

		const tmCore = await createTmCore({ projectPath: projectDir });
		domain = new GitHubDomain(projectDir, {
			clientFactory: (repo) =>
				new GhCliClient(repo, { cwd: projectDir, timeoutMs: 300 }),
			getActiveTag: () => 'master'
		});
		domain.setTasksDomain(tmCore.tasks);
	});

	afterEach(() => {
		process.env.PATH = originalPath;
		const pids = fs.existsSync(pidFile)
			? fs.readFileSync(pidFile, 'utf8').trim().split(' ').map(Number)
			: [];
		for (const pid of pids) if (isAlive(pid)) process.kill(pid, 'SIGKILL');
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it.each([
		['push', () => domain.push({ repo: REPO })],
		['pull', () => domain.pull({ repo: REPO })],
		['import', () => domain.import({ repo: REPO })]
	])('%s kills a stalled gh and fails with a hint', async (_name, run) => {
		const before = fs.readFileSync(tasksFile, 'utf8');

		const error = await run().catch((e) => e);

		expect(error).toMatchObject({
			code: 'NETWORK_ERROR',
			message: expect.stringContaining('did not finish within'),
			hint: expect.stringContaining('gh auth status')
		});
		const [ghPid] = fs.readFileSync(pidFile, 'utf8').trim().split(' ');
		// Gone once Node reaps it
		await vi.waitFor(() => expect(isAlive(Number(ghPid))).toBe(false));
		expect(fs.readFileSync(tasksFile, 'utf8')).toBe(before);
	});
});
