/**
 * @fileoverview `go --project` runs its steps from that folder (#1149). The
 * steps are not run: `spawn` is faked.
 */

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:child_process')>()),
	spawn: vi.fn()
}));

import { spawn } from 'node:child_process';
import { GoCommand } from './go.command.js';

describe('go --project', () => {
	let dir: string;
	let err: string[];

	const go = (...args: string[]) =>
		new GoCommand().parseAsync(args, { from: 'user' });

	beforeEach(() => {
		process.exitCode = undefined;
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-project-'));
		fs.writeFileSync(path.join(dir, 'prd.md'), '# App\n');
		err = [];
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(a.join(' '));
		});
		vi.mocked(spawn).mockImplementation((() => {
			const child = new EventEmitter();
			queueMicrotask(() => child.emit('close', 0, null));
			return child;
		}) as never);
	});

	afterEach(() => {
		process.exitCode = undefined;
		vi.restoreAllMocks();
		vi.mocked(spawn).mockReset();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('runs every step from the project and on it, with the PRD path made absolute', async () => {
		const project = path.join(dir, 'app');
		fs.mkdirSync(project);
		const chdir = vi.spyOn(process, 'chdir').mockImplementation(() => {});
		const prd = path.join(dir, 'prd.md');

		// --trust: nothing to ask before the steps
		await go(
			path.relative(process.cwd(), prd),
			'--project',
			project,
			'--trust'
		);

		expect(chdir).toHaveBeenCalledWith(project);
		expect(
			vi.mocked(spawn).mock.calls.map(([, args]) => (args as string[]).slice(1))
		).toEqual([
			['init', '--yes'],
			// Named, or the steps would work on TASKGRAPH_PROJECT_ROOT's project
			['parse-prd', prd, '--append', '--project', project],
			['loop', '--trust', '--project', project]
		]);
	});

	it("stops before any step when the folder doesn't exist", async () => {
		await go(path.join(dir, 'prd.md'), '--project', path.join(dir, 'nope'));

		expect(err.join('\n')).toContain(`No folder at ${path.join(dir, 'nope')}`);
		expect(process.exitCode).toBe(1);
		expect(spawn).not.toHaveBeenCalled();
	});
});
