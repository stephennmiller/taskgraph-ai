/**
 * @fileoverview A --verbose loop iteration past TASKGRAPH_LOOP_TIMEOUT_MS
 * ends even when a process Claude started still holds its output open (#659)
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoopService } from '../../../src/modules/loop/services/loop.service.js';

describe.skipIf(process.platform === 'win32')('loop iteration timeout', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-loop-timeout-'));
		const bin = path.join(dir, 'bin');
		fs.mkdirSync(bin);
		// A fake claude whose background child keeps stdout open after claude is killed
		fs.writeFileSync(
			path.join(bin, 'claude'),
			'#!/bin/sh\nsleep 30 &\nsleep 30\n',
			{ mode: 0o755 }
		);
		vi.stubEnv('PATH', `${bin}${path.delimiter}${process.env.PATH}`);
		vi.stubEnv('TASKGRAPH_LOOP_TIMEOUT_MS', '300');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('stops a --verbose iteration whose subprocess outlives claude', async () => {
		const service = new LoopService({ projectRoot: dir });
		const started = Date.now();

		const result = await service.run({
			prompt: 'default',
			iterations: 1,
			sleepSeconds: 0,
			progressFile: path.join(dir, 'progress.txt'),
			verbose: true
		});

		expect(Date.now() - started).toBeLessThan(10_000);
		expect(result.iterations[0].status).toBe('error');
		expect(result.iterations[0].message).toContain('TASKGRAPH_LOOP_TIMEOUT_MS');
	}, 20_000);
});
