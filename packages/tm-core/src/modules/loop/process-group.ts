/**
 * @fileoverview Start and stop Claude Code together with the processes it
 * started. The loop starts Claude in its own process group (POSIX), so one
 * signal reaches every process in that group (#705); a stop is SIGTERM, then
 * SIGKILL for what is still there after a grace period (#1121).
 */

import {
	type ChildProcess,
	type SpawnOptions,
	spawn
} from 'node:child_process';
import os from 'node:os';

/** Signals that stop a command the way Ctrl-C does */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = [
	'SIGINT',
	'SIGTERM',
	'SIGHUP'
];

/** How long a process told to stop gets to exit before SIGKILL */
export const KILL_GRACE_MS = 5000;

/** Spawn `detached` value: its own process group on POSIX; Windows has none */
const OWN_PROCESS_GROUP = process.platform !== 'win32';

/** Start a process in its own process group (POSIX), so stopping it stops what it started */
export function spawnInOwnGroup(
	command: string,
	args: string[],
	options: SpawnOptions,
	spawner: (
		command: string,
		args: string[],
		options: SpawnOptions
	) => ChildProcess = spawn
): ChildProcess {
	return spawner(command, args, { ...options, detached: OWN_PROCESS_GROUP });
}

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

/**
 * Stop the child's process group: SIGTERM now, SIGKILL after the grace period
 * if the child is still there. On Windows, where a kill can't be ignored,
 * both end just the child.
 */
export function stopProcessGroup(
	child: ChildProcess,
	graceMs = KILL_GRACE_MS
): void {
	killProcessGroup(child, 'SIGTERM');
	const timer = setTimeout(() => killProcessGroup(child, 'SIGKILL'), graceMs);
	// Never keeps this process alive; killProcessGroup skips a child that exited
	timer.unref();
	child.once('close', () => clearTimeout(timer));
}

/**
 * Run `work`, exiting on a stop signal with what a shell reports for it (143
 * for SIGTERM, 130 for Ctrl-C). The Agent SDK stops the Claude it started
 * when this process exits, not when a signal ends it, so a stopped AI command
 * would otherwise leave its Claude running (#1103, #1121).
 */
export async function exitOnStopSignals<T>(work: () => Promise<T>): Promise<T> {
	const stop = (sig: NodeJS.Signals) =>
		process.exit(128 + os.constants.signals[sig]);
	for (const sig of STOP_SIGNALS) process.on(sig, stop);
	try {
		return await work();
	} finally {
		for (const sig of STOP_SIGNALS) process.off(sig, stop);
	}
}
