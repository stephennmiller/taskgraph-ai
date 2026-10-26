/**
 * @fileoverview A stand-in for the `claude` process the loop spawns, for
 * specs that mock node:child_process
 */

import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';

interface FakeRun {
	stdout?: string;
	stderr?: string;
	/** Exit code; null for a process stopped by a signal */
	status?: number | null;
	/** Emitted in place of output, like a spawn that failed (ENOENT) */
	error?: Error;
	/** Never exits on its own; kill() closes it */
	hang?: boolean;
}

/** Writes its output, then closes, on later turns of the event loop */
export function fakeClaude({
	stdout = '',
	stderr = '',
	status = 0,
	error,
	hang = false
}: FakeRun = {}) {
	const child = Object.assign(new EventEmitter(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		pid: undefined,
		exitCode: null,
		signalCode: null,
		killed: false,
		kill: vi.fn(() => {
			child.emit('close', null);
			return true;
		})
	});
	if (!hang) {
		setImmediate(() => {
			if (error) return void child.emit('error', error);
			child.stdout.end(stdout);
			child.stderr.end(stderr);
			setImmediate(() => child.emit('close', status));
		});
	}
	return child;
}
