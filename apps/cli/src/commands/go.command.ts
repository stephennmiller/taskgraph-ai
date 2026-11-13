/**
 * @fileoverview `taskgraph go <prd>`: from a PRD to built tasks in one
 * command (#957). Runs `init --yes` when the folder isn't a project yet,
 * `parse-prd --append` (no tasks yet appends to nothing, so a first run and
 * a later one are the same call), then `loop`. Each step is this CLI run
 * again, and the first step that fails stops the rest. The steps before
 * `loop` print their result without a next step (#1146). `go` settles
 * loop's consent before the first step, so no planning is paid for and then
 * refused: a run that plans new tasks asks even where an approval is stored,
 * and a run that only resumes lets that approval stand. A yes is stored when
 * the loop step starts, not before. On a rerun it says what loop resumes
 * before loop starts.
 * A signal that stops `go` goes on to the running step (#1103).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	SKIP_AUTO_UPDATE_ENV,
	STOP_SIGNALS,
	createTmCore,
	isGoTrusted,
	isTaskGraphProject,
	resolveProjectRoot,
	trustLoop
} from '@tm/core';
import { Command } from 'commander';
import { formatGoResume } from '../ui/formatters/go-formatters.js';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { printError } from '../utils/error-handler.js';
import { GO_STEP_ENV } from '../utils/go-step.js';
import { projectOption } from '../utils/shared-options.js';
import { confirmLoopTrust } from './loop.command.js';

interface GoCommandOptions {
	trust?: boolean;
	sandbox?: boolean;
	project?: string;
}

/**
 * The CLI commands `go` runs for `prd`, in order.
 * @param options.trust - Also set once `go` itself asked and got a yes
 * @param project - The `--project` folder, absolute. The steps name it too:
 *   from the folder alone they would follow TASKGRAPH_PROJECT_ROOT instead
 */
function goSteps(
	prd: string,
	isProject: boolean,
	options: GoCommandOptions,
	project?: string
): string[][] {
	const inProject = project ? ['--project', project] : [];
	return [
		// init takes no --project: it sets up the folder it runs in
		...(isProject ? [] : [['init', '--yes']]),
		['parse-prd', prd, '--append', ...inProject],
		[
			'loop',
			...(options.trust ? ['--trust'] : []),
			...(options.sandbox ? ['--sandbox'] : []),
			...inProject
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

		this.description('Plan a PRD into tasks and build them')
			.argument('<prd>', 'Path to the PRD file')
			.option(
				'--trust',
				'Let loop run Claude Code with permission prompts off, without asking'
			)
			.option('--sandbox', 'Run loop in Docker sandbox mode')
			.addOption(projectOption())
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

	/**
	 * Whether parse-prd will have the AI plan tasks from `prd`: not when every
	 * section already has its tasks. true when that can't be told
	 */
	private async plansTasks(
		projectRoot: string,
		prd: string,
		isProject: boolean
	): Promise<boolean> {
		if (!isProject) return true;
		try {
			const tmCore = await createTmCore({ projectPath: projectRoot });
			try {
				return await tmCore.tasks.prdHasNewSections({
					prdPath: path.resolve(prd)
				});
			} finally {
				await tmCore.close();
			}
		} catch {
			return true;
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
		const projectRoot = resolveProjectRoot(options.project);
		if (options.project) {
			// Each step is this CLI run again, so it runs from the project
			prd = path.resolve(prd);
			try {
				process.chdir(projectRoot);
			} catch {
				printError(
					`No folder at ${terminalSafe(options.project)}`,
					'Create it first; `taskgraph go` sets up TaskGraph in it'
				);
				process.exitCode = 1;
				return;
			}
		}
		const isProject = isTaskGraphProject(projectRoot);
		// Loop's question, before any step: planning costs an AI call (#1146).
		// `asked`: this run got a yes of its own, which covers what it plans
		let asked = false;
		if (!options.trust && !options.sandbox) {
			const trusted = isGoTrusted(
				projectRoot,
				await this.plansTasks(projectRoot, prd, isProject)
			);
			// The yes is stored at the loop step: a run that fails or is stopped
			// before it leaves no approval behind
			const approved = await confirmLoopTrust({
				isTrusted: () => trusted,
				trust: () => {}
			});
			if (!approved) return;
			asked = !trusted;
		}
		const project = options.project ? projectRoot : undefined;
		const steps = goSteps(
			prd,
			isProject,
			{ ...options, trust: options.trust || asked },
			project
		);
		for (const args of steps) {
			const isLoop = args[0] === 'loop';
			// The yes covers the tasks parse-prd added. Stored for the project loop
			// is about to find: init may have made it below the root found above,
			// and loop checks that folder's approval before each iteration
			if (isLoop && asked) trustLoop(resolveProjectRoot(project));
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
