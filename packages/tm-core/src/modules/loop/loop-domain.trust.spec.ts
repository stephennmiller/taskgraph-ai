/**
 * @fileoverview A parallel run approved through the trust file keeps that
 * approval for the task changes its Claude processes made
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TasksDomain } from '../tasks/tasks-domain.js';
import { LoopDomain } from './loop-domain.js';
import { isLoopTrusted, trustLoop, untrustLoop } from './loop-trust.js';
import { ParallelLoopRunner } from './parallel/parallel-runner.js';

vi.mock('./parallel/parallel-runner.js', () => ({
	ParallelLoopRunner: vi.fn()
}));

describe('LoopDomain.runParallel trust', () => {
	let home: string;
	let project: string;
	let domain: LoopDomain;
	const writeTasks = (details: string) => {
		const dir = path.join(project, '.taskgraph', 'tasks');
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'tasks.json'),
			JSON.stringify({ master: { tasks: [{ id: '1', details }] } })
		);
	};
	const runWorkers = (work: () => void) =>
		vi.mocked(ParallelLoopRunner).mockImplementation(function () {
			return {
				run: async () => {
					work();
					return { tasks: [] };
				}
			};
		} as never);

	beforeEach(() => {
		home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-par-')));
		project = path.join(home, 'project');
		fs.mkdirSync(project);
		vi.stubEnv('HOME', home);
		writeTasks('Use the session store');
		trustLoop(project, home);
		domain = new LoopDomain(
			{ getProjectRoot: () => project } as unknown as ConfigManager,
			{} as TasksDomain
		);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('keeps the approval for the task changes the run made', async () => {
		runWorkers(() => writeTasks('Use the session store\nnote: done'));

		await domain.runParallel({ parallel: 2, trusted: true });

		expect(isLoopTrusted(project, home)).toBe(true);
	});

	it('does not restore an approval withdrawn during the run', async () => {
		runWorkers(() => {
			writeTasks('Imported work');
			untrustLoop(project, home);
		});

		await domain.runParallel({ parallel: 2, trusted: true });

		expect(isLoopTrusted(project, home)).toBe(false);
	});
});
