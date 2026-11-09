/**
 * @fileoverview `taskgraph go <prd>`: from a PRD to built tasks in one
 * command (#957). Runs `init --yes` when the folder isn't a project yet,
 * `parse-prd --append` (no tasks yet appends to nothing, so a first run and
 * a later one are the same call), then `loop`. Each step is this CLI run
 * again, so it prints what it always prints, and the first step that fails
 * stops the rest. On a rerun it says what loop resumes before loop starts.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import {
	SKIP_AUTO_UPDATE_ENV,
	createTmCore,
	isTaskGraphProject,
	resolveProjectRoot
} from '@tm/core';
import { Command } from 'commander';
import { formatGoResume } from '../ui/formatters/go-formatters.js';
import { printError } from '../utils/error-handler.js';

interface GoCommandOptions {
	trust?: boolean;
	sandbox?: boolean;
}

/** The CLI commands `go` runs for `prd`, in order */
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
		for (const args of goSteps(prd, isProject, options)) {
			if (isProject && args[0] === 'loop') {
				// Only a heads-up: a file loop can't read fails loop's own way
				await this.printResume(projectRoot).catch(() => {});
			}
			// The parent already checked for an update; the steps don't again
			const step = spawnSync(process.execPath, [process.argv[1], ...args], {
				stdio: 'inherit',
				env: { ...process.env, [SKIP_AUTO_UPDATE_ENV]: '1' }
			});
			if (step.status !== 0) {
				process.exitCode = step.status ?? 1;
				return;
			}
		}
	}
}
