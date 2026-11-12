/**
 * @fileoverview `taskgraph go <prd>` against the built CLI with the fake
 * `claude` program (#957): without a terminal, `--trust` or `--sandbox` it
 * stops before planning anything (#1146), and a SIGTERM to `go` alone stops
 * the running step too (#1103). What it runs once approved is in
 * `go.command.consent.spec.ts`; `loop` itself is never started here.
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

	it('without a terminal or --trust, stops before it plans anything (#1146)', () => {
		spawnSync('git', ['init', '-q'], { cwd: project });
		expect(run(project, {}, 'init', '--yes').status).toBe(0);
		fs.mkdirSync(path.join(project, 'docs'));
		fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ object: { tasks: [], metadata: null } }]
		});

		// HOME: no approval stored for this project, whatever the machine has
		const res = run(project, { ...fake.env, HOME: work }, 'go', 'docs/prd.md');

		// loop's own error and hint, each within 80 columns, and nothing else
		expect(res.status).toBe(1);
		expect(res.stderr).toContain('permission prompts off');
		expect(res.stderr).toContain('--trust');
		for (const line of res.stderr.trimEnd().split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
		expect(res.stdout).toBe('');
		// parse-prd never ran: no AI call was paid for and then refused
		expect(readTrace(fake.dir)).toHaveLength(0);
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
			// --sandbox: nothing to ask before the first step. loop is never
			// reached, since parse-prd is still waiting when the signal comes
			const args = [binPath, 'go', 'docs/prd.md', '--sandbox'];
			const go = spawn(process.execPath, args, {
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
				const [claude] = readTrace(fake.dir);
				step = claude.ppid;
				expect(alive(step)).toBe(true);

				// Only `go`, as a supervisor or `timeout` would; not the group
				go.kill('SIGTERM');

				// What a shell reports for SIGTERM, and neither parse-prd nor the
				// Claude it started is left running
				expect(await ended).toBe(143);
				await vi.waitFor(
					() => {
						expect(alive(step)).toBe(false);
						expect(alive(claude.pid)).toBe(false);
					},
					{ timeout: 20000, interval: 100 }
				);
			} finally {
				go.kill('SIGKILL');
				for (const { pid } of readTrace(fake.dir)) {
					if (alive(pid)) process.kill(pid, 'SIGKILL');
				}
				if (step && alive(step)) process.kill(step, 'SIGKILL');
			}
		}
	);
});
