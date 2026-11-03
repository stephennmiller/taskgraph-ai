/**
 * @fileoverview The smoke check a loop run's `set-status done` must pass
 * (#949): `loop.smokeCommand` in .taskgraph/config.json, a command that runs
 * the app through its real entry point. A task whose own tests pass while
 * the entry point still calls stubs isn't done. It runs only inside a loop
 * run, whose approval covers the setting, so a cloned repository's config
 * can't run a command when you mark a task done by hand.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
	LOOP_CHILD_ENV,
	PARALLEL_WORKER_ENV
} from '../../../common/constants/auto-update.js';
import {
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';

const execAsync = promisify(exec);

const SMOKE_TIMEOUT_MS = 5 * 60 * 1000;
/** Output lines a failure shows: enough to see the error, not the whole log */
const OUTPUT_LINES = 20;

/**
 * The command to run before a task is marked done, or undefined when this
 * isn't a loop run or no command is set
 * @throws TaskGraphError (with a hint) when the setting isn't a non-empty string
 */
export function smokeCommandFor(
	loop: unknown,
	env: NodeJS.ProcessEnv = process.env
): string | undefined {
	if (env[LOOP_CHILD_ENV] !== '1' && env[PARALLEL_WORKER_ENV] !== '1') {
		return undefined;
	}
	const value =
		loop && typeof loop === 'object'
			? (loop as { smokeCommand?: unknown }).smokeCommand
			: undefined;
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || !value.trim()) {
		throw errorWithHint(
			ERROR_CODES.INVALID_CONFIGURATION,
			`loop.smokeCommand in .taskgraph/config.json is ${JSON.stringify(value)}; use a command`,
			"Set it to a command that runs the app's entry point, such as 'node dist/cli.js < smoke.txt', or remove it"
		);
	}
	return value;
}

/**
 * Run the smoke command in the project root
 * @throws TaskGraphError with the command's last output lines when it fails
 */
export async function runSmokeCheck(
	command: string,
	cwd: string,
	taskIds: string[]
): Promise<void> {
	try {
		await execAsync(command, {
			cwd,
			timeout: SMOKE_TIMEOUT_MS,
			maxBuffer: 10 * 1024 * 1024
		});
	} catch (error) {
		const failed = error as {
			stdout?: string;
			stderr?: string;
			code?: number | string;
			killed?: boolean;
		};
		const why = failed.killed
			? `didn't finish within ${SMOKE_TIMEOUT_MS / 60000} minutes`
			: `exited with ${failed.code ?? 'an error'}`;
		const output = `${failed.stdout ?? ''}${failed.stderr ?? ''}`
			.trimEnd()
			.split('\n')
			.slice(-OUTPUT_LINES)
			.join('\n');
		const ids = taskIds.join(', ');
		throw errorWithHint(
			ERROR_CODES.TASK_STATUS_ERROR,
			`Task ${ids} not marked done: the smoke check \`${command}\` ${why}${output ? `\n${output}` : ''}`,
			'Fix what the smoke check shows, then mark the task done again'
		);
	}
}
