/**
 * @fileoverview `taskgraph doctor`: checks Node, Claude Code and its sign-in,
 * the project, the Claude Code plugin and the MCP server, and says how to fix
 * each one that failed. Thin layer over tm-core's runDoctor(). Exits 1 when a
 * check fails, so a script can gate on it. Works outside a project.
 */

import { runDoctor } from '@tm/core';
import { Command } from 'commander';
import { formatDoctorReport } from '../ui/formatters/doctor-formatters.js';
import { printJson } from '../utils/json-output.js';

interface DoctorCommandOptions {
	json?: boolean;
	project?: string;
}

export class DoctorCommand extends Command {
	constructor(name?: string) {
		super(name || 'doctor');

		this.description('Check that TaskGraph and Claude Code are set up')
			.option('--json', 'Output JSON')
			.option(
				'-p, --project <path>',
				'Project root directory (auto-detected if not provided)'
			)
			.action(async (options: DoctorCommandOptions) => {
				const report = await runDoctor({ projectPath: options.project });
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
