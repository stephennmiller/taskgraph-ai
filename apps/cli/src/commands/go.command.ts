/**
 * @fileoverview `taskgraph go <prd>`: from a PRD to built tasks in one
 * command (#957). Runs `init --yes` when the folder isn't a project yet,
 * `parse-prd --append` (no tasks yet appends to nothing, so a first run and
 * a later one are the same call), then `loop`. Each step is this CLI run
 * again, and the first step that fails stops the rest. The steps before
 * `loop` print their result without a next step (#1146). `go` settles
 * loop's consent before the first step, so no planning is paid for and then
 * refused. On a rerun it says what loop resumes before loop starts.
 * A signal that stops `go` goes on to the running step (#1103).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import {
	SKIP_AUTO_UPDATE_ENV,
	STOP_SIGNALS,
	createTmCore,
	isLoopTrusted,
	isTaskGraphProject,
	resolveProjectRoot,
	trustLoop
} from '@tm/core';
import { Command } from 'commander';
import { formatGoResume } from '../ui/formatters/go-formatters.js';
import { printError } from '../utils/error-handler.js';
import { GO_STEP_ENV } from '../utils/go-step.js';
import { confirmLoopTrust } from './loop.command.js';

interface GoCommandOptions {
	trust?: boolean;
	sandbox?: boolean;
}

/**
 * The CLI commands `go` runs for `prd`, in order
 * @param options.trust - Also set once `go` itself settled the consent
 */
function goSteps(
	prd: string,
	isProject: boolean,
	options: GoCommandOptions
): string[][] {
	return [
		...(isProject ? [] : [['init', '--yes']]),
		['parse-prd', prd, '--append'],
		[
			'loop',
			...(options.trust ? ['--trust'] : []),
			...(options.sandbox ? ['--sandbox'] : [])
		]
	];
}

/** How a step ended. `stopped`: a stop signal came in while it ran */
interface StepResult {
	code: number | null;
	signal: NodeJS.Signals | null;
	stopped: boolean;
}

/**
 * Run one step and pass it every stop signal this process gets: a `kill` of
 * `go` alone would otherwise leave `loop` and Claude Code running (#1103).
 * On Ctrl-C the step gets the signal twice (the terminal sends it to the
 * whole group), which stops it just the same.
 * @param env - Set on the step, over this process's environment
 */
export function runStep(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv = {}
): Promise<StepResult> {
	return new Promise((resolve) => {
		// The parent already checked for an update; the steps don't again
		const child = spawn(command, args, {
			stdio: 'inherit',
			env: { ...process.env, [SKIP_AUTO_UPDATE_ENV]: '1', ...env }
		});
		let stopped = false;
		const forward = (signal: NodeJS.Signals) => {
			stopped = true;
			child.kill(signal);
		};
		const done = (code: number | null, signal: NodeJS.Signals | null) => {
			for (const sig of STOP_SIGNALS) process.off(sig, forward);
			resolve({ code, signal, stopped });
		};
		for (const sig of STOP_SIGNALS) process.on(sig, forward);
		child.once('error', () => done(1, null));
		child.once('close', done);
	});
}

/**
 * `go`'s exit code for a step that failed or was stopped. For one a signal
 * ended, what a shell reports (143 for SIGTERM, 130 for Ctrl-C)
 */
export const stepExitCode = ({ code, signal }: StepResult): number =>
	signal ? 128 + os.constants.signals[signal] : code || 1;

export class GoCommand extends Command {
	constructor(name?: string) {
		super(name || 'go');

		this.description('Plan a PRD into tasks and build them with Claude Code')
			.argument('<prd>', 'Path to the PRD file')
			.option(
				'--trust',
				'Let loop run Claude Code with permission prompts off, without asking'
			)
			.option('--sandbox', 'Run loop in Docker sandbox mode')
			.action((prd: string, options: GoCommandOptions) =>
				this.run(prd, options)
			);
	}

	/** `Resuming: 3 done, task 4 in progress, 5 pending`, or nothing on a first run */
	private async printResume(projectRoot: string): Promise<void> {
		const tmCore = await createTmCore({ projectPath: projectRoot });
		try {
			const [stats, prime] = await Promise.all([
				tmCore.tasks.getStats(),
				tmCore.tasks.getPrimeContext()
			]);
			const line = formatGoResume(stats.byStatus, prime.inProgress);
			if (line) console.log(line);
		} finally {
			await tmCore.close();
		}
	}

	private async run(prd: string, options: GoCommandOptions): Promise<void> {
		if (!fs.existsSync(prd)) {
			printError(
				`${prd} not found`,
				'Write the PRD first, then run `taskgraph go <file>`'
			);
			process.exitCode = 1;
			return;
		}
		const projectRoot = resolveProjectRoot();
		const isProject = isTaskGraphProject(projectRoot);
		// Loop's question, before any step: planning costs an AI call (#1146)
		const asks = !options.trust && !options.sandbox;
		if (
			asks &&
			!(await confirmLoopTrust({
				isTrusted: () => isLoopTrusted(projectRoot),
				trust: () => trustLoop(projectRoot)
			}))
		) {
			return;
		}
		for (const args of goSteps(prd, isProject, {
			...options,
			trust: options.trust || asks
		})) {
			const isLoop = args[0] === 'loop';
			// parse-prd withdrew the approval; it covers the tasks this run planned
			if (isLoop && asks) trustLoop(projectRoot);
			if (isLoop && isProject) {
				// Only a heads-up: a file loop can't read fails loop's own way
				await this.printResume(projectRoot).catch(() => {});
			}
			// Not on loop: Claude Code and the commands it runs would inherit it
			const step = await runStep(
				process.execPath,
				[process.argv[1], ...args],
				isLoop ? {} : { [GO_STEP_ENV]: '1' }
			);
			if (step.code !== 0 || step.stopped) {
				process.exitCode = stepExitCode(step);
				return;
			}
		}
	}
}
