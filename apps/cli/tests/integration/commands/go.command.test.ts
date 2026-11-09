/**
 * @fileoverview `taskgraph go <prd>` against the built CLI with the fake
 * `claude` program (#957): it plans the PRD with `parse-prd --append`, then
 * hands over to `loop`, saying what it resumes on a rerun, and the first
 * step that fails stops it. A SIGTERM to `go` alone stops the running step
 * too (#1103).
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

const PRD = `# Notes app

## Notes

Create and edit notes.
`;

describe.skipIf(!built)('go (fake claude)', { timeout: 120000 }, () => {
	let project: string;
	let work: string;

	const run = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd,
			encoding: 'utf8',
			timeout: 90000,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				...env
			}
		});

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-work-'));
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('stops before init when the PRD is missing', () => {
		const res = run(project, {}, 'go', 'docs/prd.md');

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('docs/prd.md not found');
		expect(fs.existsSync(path.join(project, '.taskgraph'))).toBe(false);
	});

	it('plans the PRD into tasks, then stops at loop without --trust', () => {
		spawnSync('git', ['init', '-q'], { cwd: project });
		expect(run(project, {}, 'init', '--yes').status).toBe(0);
		fs.mkdirSync(path.join(project, 'docs'));
		fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [
				{
					object: {
						tasks: [
							{
								id: 1,
								title: 'Notes',
								description: 'Create and edit notes',
								details: 'Details',
								testStrategy: 'Tests',
								priority: 'medium',
								dependencies: [],
								status: 'pending',
								section: 'notes'
							}
						],
						metadata: null
					}
				}
			]
		});

		const res = run(project, fake.env, 'go', 'docs/prd.md');

		const { tasks } = JSON.parse(
			fs.readFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		).master;
		expect(tasks.map((t: { title: string }) => t.title)).toEqual(['Notes']);
		// loop asks before turning permission prompts off; no terminal here
		expect(res.status).toBe(1);
		expect(`${res.stdout}${res.stderr}`).toContain('--trust');
		// A first run has nothing to resume
		expect(res.stdout).not.toContain('Resuming');
	});

	it('says what it resumes on a rerun, before loop', () => {
		spawnSync('git', ['init', '-q'], { cwd: project });
		expect(run(project, {}, 'init', '--yes').status).toBe(0);
		const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		const task = (id: string, status: string) => ({
			id,
			title: `Task ${id}`,
			description: 'd',
			status,
			priority: 'medium',
			dependencies: [],
			subtasks: []
		});
		data.master.tasks = [
			task('1', 'done'),
			task('2', 'in-progress'),
			task('3', 'pending')
		];
		fs.writeFileSync(file, JSON.stringify(data));
		fs.mkdirSync(path.join(project, 'docs'));
		fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ object: { tasks: [], metadata: null } }]
		});

		const res = run(project, fake.env, 'go', 'docs/prd.md');

		expect(res.stdout).toContain(
			'Resuming: 1 done, task 2 in progress, 1 pending'
		);
		expect(res.status).toBe(1);
	});

	// Windows has no SIGTERM to pass on, and its fake claude has a launcher between
	it.skipIf(process.platform === 'win32')(
		'stops the running step when go alone gets SIGTERM (#1103)',
		async () => {
			spawnSync('git', ['init', '-q'], { cwd: project });
			expect(run(project, {}, 'init', '--yes').status).toBe(0);
			fs.mkdirSync(path.join(project, 'docs'));
			fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
			// parse-prd waits on the model for good: nothing makes `never`
			const fake = installFakeClaude({
				projectDir: project,
				workDir: work,
				replies: [{ object: { tasks: [] }, holdUntil: 'never' }]
			});
			const go = spawn(process.execPath, [binPath, 'go', 'docs/prd.md'], {
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
				go.once('close', resolve)
			);
			const alive = (pid: number) => {
				try {
					process.kill(pid, 0);
					return true;
				} catch {
					return false;
				}
			};
			let step = 0;
			try {
				// The fake claude is traced once parse-prd, its parent, calls it
				await vi.waitFor(() => expect(readTrace(fake.dir)).toHaveLength(1), {
					timeout: 60000,
					interval: 100
				});
				step = readTrace(fake.dir)[0].ppid;
				expect(alive(step)).toBe(true);

				// Only `go`, as a supervisor or `timeout` would; not the group
				go.kill('SIGTERM');

				// The step's own exit code, or null when the signal ended both
				expect(await ended).not.toBe(0);
				await vi.waitFor(() => expect(alive(step)).toBe(false), {
					timeout: 20000,
					interval: 100
				});
			} finally {
				go.kill('SIGKILL');
				// The fake claude outlives a killed parse-prd: it's still holding
				for (const { pid } of readTrace(fake.dir)) {
					if (alive(pid)) process.kill(pid, 'SIGKILL');
				}
				if (step && alive(step)) process.kill(step, 'SIGKILL');
			}
		}
	);
});
