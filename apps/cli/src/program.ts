/**
 * @fileoverview The `taskgraph` Commander program and the run around it:
 * update check, parse, and the one-time tag migration notice.
 *
 * `--version`, bare `taskgraph` and the top-level help screen never get here;
 * scripts/dev.js answers them before this module loads (#248).
 */

import path from 'node:path';
import {
	PROJECT_ROOT_ENV,
	TASKGRAPH_VERSION,
	isTaskGraphProject,
	resolveProjectRoot,
	takeMigrationNotice
} from '@tm/core';
import { Command } from 'commander';
import { registerAllCommands } from './command-registry.js';
import { formatHelp } from './ui/formatters/help-formatters.js';
import { theme } from './ui/theme.js';
import {
	checkForUpdate,
	displayUpgradeNotification,
	performAutoUpdate,
	restartWithNewVersion
} from './utils/auto-update/index.js';
import {
	autoUpdateSkipReason,
	isAutoInstallEnabled
} from './utils/auto-update/policy.js';
import {
	displayError,
	formatCommanderError,
	printError
} from './utils/error-handler.js';
import { wantsJsonOutput } from './utils/json-output.js';

const RUNS_WITHOUT_PROJECT = new Set([
	'init',
	'help',
	'completion',
	// Git runs the merge driver from the repository root, which may not be
	// the project root
	'merge-driver',
	'doctor',
	// Installs the CLI itself; it doesn't read a project's tasks
	'upgrade'
]);

/**
 * Stop a command that needs a project when it runs outside one.
 *
 * Without this check each command failed in its own way, after a stack of
 * "Configuration file not found" warnings, and `list`, `next` and `tags`
 * left an empty .taskgraph folder behind that made the next command think
 * the folder was a project.
 *
 * @param _hookedCommand - The program
 * @param actionCommand - The command about to run
 */
function requireProject(_hookedCommand: Command, actionCommand: Command) {
	let topLevel = actionCommand;
	while (topLevel.parent?.parent) topLevel = topLevel.parent;
	const names = [topLevel.name(), ...topLevel.aliases()];
	if (names.some((name) => RUNS_WITHOUT_PROJECT.has(name))) return;

	// An explicit tasks file means the caller has said where the project is
	if (actionCommand.getOptionValueSource('file') === 'cli') return;

	const takesProject = actionCommand.options.some(
		(option) => option.attributeName() === 'project'
	);
	const projectOption = takesProject ? actionCommand.opts().project : null;
	const explicitRoot =
		typeof projectOption === 'string' ? path.resolve(projectOption) : null;

	// The same root the command will use: --project, else
	// TASKGRAPH_PROJECT_ROOT, else the one found from here
	const root = resolveProjectRoot(explicitRoot ?? undefined);
	if (isTaskGraphProject(root)) return;

	// A --project inside the variable's worktrees resolves to the variable's project
	if (explicitRoot === root) {
		printError(
			`No TaskGraph project at ${explicitRoot}`,
			'Run `taskgraph init` in that folder to set one up'
		);
	} else if (process.env[PROJECT_ROOT_ENV]?.trim()) {
		printError(
			`No TaskGraph project at ${root}, which ${PROJECT_ROOT_ENV} names`,
			`Unset ${PROJECT_ROOT_ENV}, or point it at your project`
		);
	} else {
		printError(
			'No TaskGraph project in this folder',
			'Run `taskgraph init` to set one up, or cd into your project'
		);
	}
	process.exit(1);
}

/**
 * Build the `taskgraph` program with every command registered
 */
export function setupCLI(): Command {
	const program = new Command()
		.name('taskgraph')
		.description('AI-driven development task management')
		.version(process.env.TM_PUBLIC_VERSION || 'unknown')
		.helpOption('-h, --help', 'Display help')
		.helpCommand(false);

	// The program's own help is the grouped screen; subcommands keep
	// Commander's
	const originalHelpInformation = program.helpInformation.bind(program);
	program.helpInformation = function (this: Command) {
		if (this.parent && this.parent !== program) {
			return originalHelpInformation();
		}
		console.log(formatHelp());
		return '';
	};

	program.on('option:unknown', function (this: Command, unknownOption) {
		const commandName = this.name() || 'unknown';
		printError(
			`Unknown option '${unknownOption}'`,
			`Run \`taskgraph ${commandName} --help\` to see its options`
		);
		process.exit(1);
	});

	program
		.command('help')
		.description('Show help information')
		.action(() => {
			program.help();
		});

	program.configureHelp({ helpWidth: 120, sortSubcommands: false });

	registerAllCommands(program);

	// Commander's own parse errors (unknown command, missing argument) read
	// like every other error. Commands added with addCommand() don't inherit
	// output settings, so apply them to the whole tree.
	const styleParseErrors = (command: Command, commandPath: string) => {
		command.configureOutput({
			outputError: (text, write) =>
				write(
					`\n${formatCommanderError(text, commandPath || undefined, command.args)}\n`
				)
		});
		for (const sub of command.commands) {
			styleParseErrors(
				sub,
				commandPath ? `${commandPath} ${sub.name()}` : sub.name()
			);
		}
	};
	styleParseErrors(program, '');

	// Runs before every subcommand's action, nested ones included
	program.hook('preAction', requireProject);

	return program;
}

/**
 * Run one `taskgraph` command
 *
 * @param argv - The full process.argv
 */
export async function runCLI(argv: string[] = process.argv): Promise<void> {
	try {
		// `completion` output is usually redirected into a file, so nothing else
		// may be printed to stdout before or after it
		// The merge driver runs inside `git merge`: no update check, no notices
		// A --json / --format json run prints only its JSON on stdout, for a
		// script or agent to parse
		const printsOnlyItsOwnOutput =
			['completion', 'merge-driver'].includes(argv[2]) ||
			wantsJsonOutput(argv.slice(2));
		// `upgrade` installs itself. A startup install would run twice.
		const explicitUpgrade = argv[2] === 'upgrade';
		// Notify only, unless the user opted in. Never install or ask from a
		// script, CI, JSON, or a process `loop` / a parallel worker started.
		if (!explicitUpgrade && autoUpdateSkipReason({ argv }) === null) {
			const updateInfo = await checkForUpdate(TASKGRAPH_VERSION);
			if (updateInfo.needsUpdate) {
				const install = isAutoInstallEnabled();
				displayUpgradeNotification(
					updateInfo.currentVersion,
					updateInfo.latestVersion,
					updateInfo.highlights,
					{ hint: !install }
				);
				if (
					install &&
					(await performAutoUpdate(updateInfo.latestVersion, { argv }))
				) {
					// The restarted process runs the user's command
					restartWithNewVersion(argv);
					return;
				}
				// If the update fails, carry on with the current version
			}
		}

		// --no-banner is read by scripts/dev.js, not a Commander option
		await setupCLI().parseAsync(argv.filter((arg) => arg !== '--no-banner'));

		if (!printsOnlyItsOwnOutput && takeMigrationNotice()) {
			console.log(
				theme.muted(
					'TaskGraph now keeps a separate task list per tag; use --tag to work in one'
				)
			);
		}
	} catch (error) {
		displayError(error);
	}
}
