/**
 * @fileoverview The Claude Code process for one loop iteration, started in
 * its own process group so a timeout or Ctrl-C stops what it started (#705)
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { childAutoUpdateEnv } from '../child-env.js';
import { OWN_PROCESS_GROUP, killProcessGroup } from '../process-group.js';

/** Signals that stop `loop`; Claude, in its own process group, gets them passed on */
const STOP_SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/**
 * Start Claude in its own process group. On timeout the whole group gets
 * SIGTERM, so the processes Claude started stop too, and onTimeout runs.
 */
export function spawnIteration(
	command: string,
	args: string[],
	cwd: string,
	timeout: number,
	onTimeout: () => void
): ChildProcess {
	const child = spawn(command, args, {
		cwd,
		stdio: ['inherit', 'pipe', 'pipe'],
		// Claude runs `taskgraph`. Mark this child so that install can't
		// start, and skip the update check entirely.
		env: childAutoUpdateEnv('loop'),
		detached: OWN_PROCESS_GROUP
	});
	const timer = setTimeout(() => {
		onTimeout();
		killProcessGroup(child, 'SIGTERM');
		// A subprocess Claude started can hold the pipes open: close them so 'close' fires
		child.stdout?.destroy();
		child.stderr?.destroy();
	}, timeout);
	// Ctrl-C reaches only the terminal's process group, which Claude has
	// left: stop Claude's group (SIGTERM, since a shell's background jobs
	// ignore SIGINT), then let the signal stop this process as before
	const forward = (sig: NodeJS.Signals): void => {
		killProcessGroup(child, 'SIGTERM');
		cleanup();
		process.kill(process.pid, sig);
	};
	const cleanup = (): void => {
		clearTimeout(timer);
		for (const sig of STOP_SIGNALS) process.off(sig, forward);
	};
	if (OWN_PROCESS_GROUP) {
		for (const sig of STOP_SIGNALS) process.on(sig, forward);
	}
	child.once('close', cleanup);
	child.once('error', cleanup);
	return child;
}
