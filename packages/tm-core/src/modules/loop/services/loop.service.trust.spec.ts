/**
 * @fileoverview A loop approved through the trust file stops before the next
 * iteration once parse-prd or github import withdraws that approval mid-run,
 * and keeps it for the task changes the run made itself
 */

import * as childProcess from 'node:child_process';
import fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isLoopTrusted, trustLoop, untrustLoop } from '../loop-trust.js';
import type { LoopConfig } from '../types.js';
import { fakeClaude } from './fake-claude.js';
import { LoopService } from './loop.service.js';

vi.mock('node:child_process');
vi.mock('node:fs/promises');

const config: LoopConfig = {
	prompt: 'default',
	iterations: 3,
	sleepSeconds: 0,
	progressFile: '/test/progress.txt'
};

describe('LoopService trust', () => {
	const spawn = vi.mocked(childProcess.spawn);
	let home: string;
	let project: string;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
		vi.mocked(fsPromises.appendFile).mockResolvedValue(undefined);
		home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-loop-')));
		project = path.join(home, 'project');
		fs.mkdirSync(project);
		vi.stubEnv('HOME', home);
		trustLoop(project, home);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('stops before the next iteration when tasks were added during the run', async () => {
		spawn.mockImplementation(() => {
			untrustLoop(project, home);
			return fakeClaude({ stdout: 'Imported the issues' }) as never;
		});

		const result = await new LoopService({ projectRoot: project }).run(config);

		expect(spawn).toHaveBeenCalledTimes(1);
		expect(result.finalStatus).toBe('error');
		expect(result.errorMessage).toMatch(/loop again/);
	});

	it('runs every iteration while the approval stands', async () => {
		spawn.mockImplementation(() => fakeClaude({ stdout: 'Done' }) as never);

		const result = await new LoopService({ projectRoot: project }).run(config);

		expect(spawn).toHaveBeenCalledTimes(3);
		expect(result.finalStatus).toBe('max_iterations');
	});

	it('keeps the approval for the task changes the run made', async () => {
		spawn.mockImplementation(() => {
			const dir = path.join(project, '.taskgraph', 'tasks');
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				path.join(dir, 'tasks.json'),
				JSON.stringify({ master: { tasks: [{ id: '1', details: 'note' }] } })
			);
			return fakeClaude({ stdout: 'Done' }) as never;
		});

		await new LoopService({ projectRoot: project }).run({
			...config,
			iterations: 1
		});

		expect(isLoopTrusted(project, home)).toBe(true);
	});
});
