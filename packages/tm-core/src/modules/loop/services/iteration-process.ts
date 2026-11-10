/**
 * @fileoverview The Claude Code process for one loop iteration, started in
 * its own process group so a timeout or Ctrl-C stops what it started (#705)
 */

import type { ChildProcess } from 'node:child_process';
import { childAutoUpdateEnv } from '../child-env.js';
import {
	KILL_GRACE_MS,
	STOP_SIGNALS,
	killProcessGroup,
	spawnInOwnGroup,
	stopProcessGroup
} from '../process-group.js';
import { sandboxRunArgs } from './docker-sandbox.js';
import { STREAM_JSON_ARGS } from './stream-events.js';

/** A stop signal this soon after the first is the same Ctrl-C, not a second one */
const REPEAT_SIGNAL_MS = 500;

/**
 * Start Claude in its own process group. After `timeout` ms with no output
 * the whole group is stopped (SIGTERM, then SIGKILL after `graceMs`), so the
 * processes Claude started stop too, and onTimeout runs. onStop runs on
 * timeout and on a stop signal, for what lives outside the group (the
 * `--sandbox` container, #743).
 */
export function spawnIteration(
	command: string,
	args: string[],
	cwd: string,
	timeout: number,
	onTimeout: () => void,
	onStop?: () => void,
	graceMs = KILL_GRACE_MS
): ChildProcess {
	const child = spawnInOwnGroup(command, args, {
		cwd,
		stdio: ['inherit', 'pipe', 'pipe'],
		// Claude runs `taskgraph`. Mark this child so that install can't
		// start, and skip the update check entirely.
		env: childAutoUpdateEnv('loop')
	});
	const timer = setTimeout(() => {
		onTimeout();
		stopProcessGroup(child, graceMs);
		onStop?.();
		// A subprocess Claude started can hold the pipes open: close them so 'close' fires
		child.stdout?.destroy();
		child.stderr?.destroy();
	}, timeout);
	// An idle limit (#977): one session works through the whole backlog, so only silence means it hung
	child.stdout?.on('data', () => timer.refresh());
	// Ctrl-C reaches only the terminal's process group, which Claude has
	// left: stop Claude's group (SIGTERM, since a shell's background jobs
	// ignore SIGINT; SIGKILL after the grace period, or at once on a second
	// signal), then let the signal stop this process as before
	let stoppedAt: number | undefined;
	const forward = (sig: NodeJS.Signals): void => {
		const reraise = (): void => {
			cleanup();
			process.kill(process.pid, sig);
		};
		if (child.exitCode !== null || child.signalCode !== null) return reraise();
		if (stoppedAt !== undefined) {
			// One Ctrl-C can arrive twice: from the terminal, and passed on by `go` or npm
			if (Date.now() - stoppedAt >= REPEAT_SIGNAL_MS) {
				killProcessGroup(child, 'SIGKILL');
			}
			return;
		}
		stoppedAt = Date.now();
		clearTimeout(timer);
		// Before reraise, which ends this process: it kills what outlived Claude
		stopProcessGroup(child, graceMs);
		child.once('exit', reraise);
		onStop?.();
	};
	const cleanup = (): void => {
		clearTimeout(timer);
		for (const sig of STOP_SIGNALS) process.off(sig, forward);
	};
	// Windows has no group to leave: Ctrl-C reaches Claude there by itself
	if (process.platform !== 'win32') {
		for (const sig of STOP_SIGNALS) process.on(sig, forward);
	}
	child.once('close', cleanup);
	child.once('error', cleanup);
	return child;
}

/** stream-json in every mode: its last event has the iteration's cost and turns */
export function buildCommandArgs(
	projectRoot: string,
	prompt: string,
	sandbox: boolean,
	extra: string[]
): string[] {
	if (sandbox) {
		return sandboxRunArgs(
			projectRoot,
			'-p',
			prompt,
			...STREAM_JSON_ARGS,
			...extra
		);
	}
	return [
		'-p',
		prompt,
		'--dangerously-skip-permissions',
		...STREAM_JSON_ARGS,
		...extra
	];
}
