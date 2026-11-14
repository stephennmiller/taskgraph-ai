/**
 * @fileoverview `taskgraph doctor`: checks Node, Claude Code and its sign-in,
 * the project, its data files and tasks, the Claude Code plugin and the MCP
 * server, and says how to fix each one that failed. `--fix` repairs what has
 * one safe answer in tasks.json. Thin layer over tm-core's runDoctor().
 * Exits 1 when a check fails (with `--fix`: still fails after the repair),
 * so a script can gate on it. Works outside a project.
 */

import { runDoctor } from '@tm/core';
import { Command } from 'commander';
import { projectOption } from '../utils/shared-options.js';
import { formatDoctorReport } from '../ui/formatters/doctor-formatters.js';
import { printJson } from '../utils/json-output.js';

interface DoctorCommandOptions {
	json?: boolean;
	fix?: boolean;
	project?: string;
}

export class DoctorCommand extends Command {
	constructor(name?: string) {
		super(name || 'doctor');

		this.description('Check that TaskGraph and Claude Code work')
			.option('--json', 'Print JSON')
			.option('--fix', 'Repair task problems that have one safe answer')
			.addOption(projectOption())
			.action(async (options: DoctorCommandOptions) => {
				const report = await runDoctor({
					projectPath: options.project,
					fix: options.fix
				});
				if (options.json) {
					printJson(report);
				} else {
					console.log(formatDoctorReport(report, { cwd: process.cwd() }));
				}
				if (!report.ok) process.exitCode = 1;
			});
	}

	static register(program: Command, name?: string): DoctorCommand {
		const command = new DoctorCommand(name);
		program.addCommand(command);
		return command;
	}
}
