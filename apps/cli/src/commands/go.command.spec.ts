/**
 * @fileoverview `go` passes stop signals on to the step it's running (#1103).
 * The step here is a small node script, not the CLI: no AI runs.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runStep } from './go.command.js';

describe('runStep', () => {
	let dir: string;
	let ready: string;

	/** A step that says when it's up, then waits to be stopped */
	const step = (onSigterm: string) => [
		'-e',
		`${onSigterm}
		require('node:fs').writeFileSync(${JSON.stringify(ready)}, '');
		setInterval(() => {}, 1000);`
	];
	const untilReady = () =>
		vi.waitFor(() => expect(fs.existsSync(ready)).toBe(true), {
			timeout: 10_000
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-step-'));
		ready = path.join(dir, 'ready');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('resolves with the exit code of a step that ran to its end', async () => {
		const result = await runStep(process.execPath, ['-e', 'process.exit(3)']);

		expect(result).toEqual({ code: 3, signal: null, stopped: false });
	});

	it('passes SIGTERM to a step that handles it, and reports its exit code', async () => {
		const before = process.listenerCount('SIGTERM');
		const running = runStep(
			process.execPath,
			step(`process.on('SIGTERM', () => process.exit(7));`)
		);
		await untilReady();

		// What `kill <pid of go>` delivers, without ending the test runner
		process.emit('SIGTERM', 'SIGTERM');

		expect(await running).toEqual({ code: 7, signal: null, stopped: true });
		expect(process.listenerCount('SIGTERM')).toBe(before);
	});

	it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)(
		'stops a step that has no handler with %s',
		async (signal) => {
			const running = runStep(process.execPath, step(''));
			await untilReady();

			process.emit(signal, signal);

			expect(await running).toEqual({ code: null, signal, stopped: true });
		}
	);

	it("fails a step that can't start", async () => {
		const result = await runStep(path.join(dir, 'missing'), []);

		expect(result).toMatchObject({ code: 1, stopped: false });
	});
});
