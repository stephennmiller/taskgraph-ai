/**
 * @fileoverview Stop Claude Code together with the processes it started.
 * The loop starts Claude in its own process group (POSIX), so one signal
 * reaches every process in that group (#705).
 */

import type { ChildProcess } from 'node:child_process';

/** Spawn `detached` value: its own process group on POSIX; Windows has none */
export const OWN_PROCESS_GROUP = process.platform !== 'win32';

/** Signal the child's process group (or just the child on Windows) */
export function killProcessGroup(
	child: ChildProcess,
	sig: NodeJS.Signals
): void {
	if (child.exitCode !== null || child.signalCode !== null) return;
	try {
		if (OWN_PROCESS_GROUP && child.pid) {
			process.kill(-child.pid, sig);
		} else {
			child.kill(sig);
		}
	} catch {
		try {
			child.kill(sig);
		} catch {
			// Already gone
		}
	}
}
