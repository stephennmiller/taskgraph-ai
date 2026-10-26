/**
 * @fileoverview The Docker sandbox `loop --sandbox` runs Claude in. Each
 * project gets one sandbox under a name the loop knows, so a timeout or
 * Ctrl-C can stop it: signalling the docker client leaves it running (#743).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DOCKER_MISSING } from './iteration-limits.js';

/** `taskgraph-loop-` and a hash of the project root */
function sandboxName(projectRoot: string): string {
	const hash = createHash('sha256').update(projectRoot).digest('hex');
	return `taskgraph-loop-${hash.slice(0, 12)}`;
}

/** `docker sandbox run` arguments for Claude in the project's sandbox */
export function sandboxRunArgs(
	projectRoot: string,
	...claudeArgs: string[]
): string[] {
	return [
		'sandbox',
		'run',
		'--name',
		sandboxName(projectRoot),
		'claude',
		...claudeArgs
	];
}

/** Stop the project's sandbox. Synchronous, so it works in a signal handler. */
export function stopSandbox(projectRoot: string): void {
	const name = sandboxName(projectRoot);
	const run = (args: string[]) =>
		spawnSync('docker', args, { stdio: 'ignore', timeout: 60_000 });
	// Older Docker Desktop has no `sandbox stop`: its sandbox is a plain container
	if (run(['sandbox', 'stop', name]).status !== 0) run(['stop', name]);
}

/** Check if Docker sandbox auth is ready */
export function checkSandboxAuth(projectRoot: string): {
	ready: boolean;
	error?: string;
} {
	const result = spawnSync(
		'docker',
		sandboxRunArgs(projectRoot, '-p', 'Say OK'),
		{
			cwd: projectRoot,
			timeout: 30000,
			encoding: 'utf-8',
			stdio: ['inherit', 'pipe', 'pipe']
		}
	);

	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return {
				ready: false,
				error: DOCKER_MISSING
			};
		}
		return { ready: false, error: `Docker error: ${result.error.message}` };
	}

	const output = (result.stdout || '') + (result.stderr || '');
	return { ready: output.toLowerCase().includes('ok') };
}

/** Run interactive Docker sandbox session for user authentication */
export function runInteractiveAuth(projectRoot: string): {
	success: boolean;
	error?: string;
} {
	const result = spawnSync(
		'docker',
		sandboxRunArgs(
			projectRoot,
			"You're authenticated! Press Ctrl+C to continue."
		),
		{
			cwd: projectRoot,
			stdio: 'inherit'
		}
	);

	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === 'ENOENT') {
			return {
				success: false,
				error: DOCKER_MISSING
			};
		}
		return { success: false, error: `Docker error: ${result.error.message}` };
	}

	if (result.status === null) {
		return {
			success: false,
			error: 'Docker terminated abnormally (no exit code)'
		};
	}

	if (result.status !== 0) {
		return {
			success: false,
			error: `Docker exited with code ${result.status}`
		};
	}

	return { success: true };
}
