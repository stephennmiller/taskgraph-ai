/**
 * @fileoverview A loop run against a real project counts a task as completed
 * only when its status moves, and stops when Claude makes no progress (#812)
 *
 * @integration
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/index.js';
import { createTask, createTasksFile } from '../../../src/testing/index.js';

/** Marks the first pending task done when FAKE_CLAUDE_FINISH is set, commits when FAKE_CLAUDE_COMMIT is; always exits 0 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
if (process.env.FAKE_CLAUDE_COMMIT) {
	require('node:child_process').execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'wip']);
}
if (process.env.FAKE_CLAUDE_FINISH) {
	const file = '.taskgraph/tasks/tasks.json';
	const data = JSON.parse(fs.readFileSync(file, 'utf8'));
	const task = data.master.tasks.find((t) => t.status === 'pending');
	if (task) task.status = 'done';
	fs.writeFileSync(file, JSON.stringify(data));
}
console.log('Worked on it.');
`;

describe.skipIf(process.platform === 'win32')('loop progress', () => {
	let dir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-')));
		const bin = path.join(dir, 'bin');
		fs.mkdirSync(bin);
		fs.writeFileSync(path.join(bin, 'claude'), FAKE_CLAUDE, { mode: 0o755 });
		vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
		const tasksDir = path.join(dir, '.taskgraph', 'tasks');
		fs.mkdirSync(tasksDir, { recursive: true });
		fs.writeFileSync(
			path.join(tasksDir, 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({ id: 1, title: 'One', status: 'pending' }),
						createTask({ id: 2, title: 'Two', status: 'pending' })
					]
				})
			)
		);
		tmCore = await createTmCore({ projectPath: dir });
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore.close();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const run = (iterations = 4) =>
		tmCore.loop.run({
			iterations,
			sleepSeconds: 0,
			trusted: true,
			callbacks: { onError: () => {} }
		});

	it('stops after two iterations that leave every task pending', async () => {
		const result = await run();

		expect(result).toMatchObject({
			totalIterations: 2,
			tasksCompleted: 0,
			finalStatus: 'error'
		});
		expect(result.errorMessage).toContain('Task 1 is stuck');
	}, 20_000);

	it('counts each task Claude marked done', async () => {
		vi.stubEnv('FAKE_CLAUDE_FINISH', '1');

		const result = await run(2);

		expect(result).toMatchObject({
			totalIterations: 2,
			tasksCompleted: 2,
			finalStatus: 'max_iterations'
		});
	}, 20_000);

	it('keeps going while Claude commits work on a task that stays in progress', async () => {
		for (const [key, value] of Object.entries({
			GIT_AUTHOR_NAME: 't',
			GIT_AUTHOR_EMAIL: 't@example.com',
			GIT_COMMITTER_NAME: 't',
			GIT_COMMITTER_EMAIL: 't@example.com',
			FAKE_CLAUDE_COMMIT: '1'
		}))
			vi.stubEnv(key, value);
		execFileSync('git', ['init', '-q'], { cwd: dir });
		execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init'], {
			cwd: dir
		});

		const result = await run(3);

		expect(result).toMatchObject({
			totalIterations: 3,
			tasksCompleted: 0,
			finalStatus: 'max_iterations'
		});
	}, 20_000);
});
