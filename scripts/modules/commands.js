/**
 * commands.js
 * Command-line interface for the TaskGraph CLI
 */

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';

// Import command registry and utilities from @tm/cli
import {
	checkForUpdate,
	displayError,
	displayUpgradeNotification,
	formatCommanderError,
	printError,
	performAutoUpdate,
	registerAllCommands,
	restartWithNewVersion,
	ui,
	wantsJsonOutput
} from '@tm/cli';
import { log } from './utils.js';

import { setSuppressConfigWarnings } from './config-manager.js';

import {
	PROJECT_ROOT_ENV,
	isTaskGraphProject,
	resolveProjectRoot
} from '@tm/core';

import { initTaskGraph } from '../../src/taskgraph.js';

import { displayBanner, displayHelp, displayTaggedTasksFYI } from './ui.js';

import { getTaskGraphVersion } from '../../src/utils/getVersion.js';

/**
 * Configure and register CLI commands
 * @param {Object} program - Commander program instance
 */
function registerCommands(programInstance) {
	// Add global error handler for unknown options
	programInstance.on('option:unknown', function (unknownOption) {
		const commandName = this._name || 'unknown';
		printError(
			`Unknown option '${unknownOption}'`,
			`Run \`taskgraph ${commandName} --help\` to see its options`
		);
		process.exit(1);
	});

	// Add help command alias
	programInstance
		.command('help')
		.description('Show help information')
		.action(() => {
			programInstance.help();
		});

	programInstance.configureHelp({
		helpWidth: 120,
		sortSubcommands: false
	});

	// ========================================
	// Register All Commands from @tm/cli
	// ========================================
	// Use the centralized command registry to register all CLI commands
	// This replaces individual command registrations and reduces duplication
	registerAllCommands(programInstance);

	return programInstance;
}

const RUNS_WITHOUT_PROJECT = new Set([
	'init',
	'help',
	'completion',
	// Git runs the merge driver from the repository root, which may not be
	// the project root
	'merge-driver',
	'doctor'
]);

/**
 * Stop a command that needs a project when it runs outside one.
 *
 * Without this check each command failed in its own way, after a stack of
 * "Configuration file not found" warnings, and `list`, `next` and `tags`
 * left an empty .taskgraph folder behind that made the next command think
 * the folder was a project.
 *
 * @param {import('commander').Command} _hookedCommand - The program
 * @param {import('commander').Command} actionCommand - The command about to run
 */
function requireProject(_hookedCommand, actionCommand) {
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
 * Setup the CLI application
 * @returns {Object} Configured Commander program
 */
function setupCLI() {
	// Create a new program instance
	const programInstance = new Command()
		.name('taskgraph')
		.description('AI-driven development task management')
		.version(process.env.TM_PUBLIC_VERSION || 'unknown')
		.helpOption('-h, --help', 'Display help')
		.addHelpCommand(false); // Disable default help command

	// Only override help for the main program, not for individual commands
	const originalHelpInformation =
		programInstance.helpInformation.bind(programInstance);
	programInstance.helpInformation = function () {
		// If this is being called for a subcommand, use the default Commander.js help
		if (this.parent && this.parent !== programInstance) {
			return originalHelpInformation();
		}
		// If this is the main program help, use our custom display
		displayHelp();
		return '';
	};

	// Register commands
	registerCommands(programInstance);

	// Commander's own parse errors (unknown command, missing argument) read
	// like every other error. Commands added with addCommand() don't inherit
	// output settings, so apply them to the whole tree.
	const styleParseErrors = (command, path) => {
		command.configureOutput({
			outputError: (text, write) =>
				write(
					`\n${formatCommanderError(text, path || undefined, command.args)}\n`
				)
		});
		for (const sub of command.commands) {
			styleParseErrors(sub, path ? `${path} ${sub.name()}` : sub.name());
		}
	};
	styleParseErrors(programInstance, '');

	// Runs before every subcommand's action, nested ones included
	programInstance.hook('preAction', requireProject);

	return programInstance;
}

/**
 * Parse arguments and run the CLI
 * @param {Array} argv - Command-line arguments
 */
async function runCLI(argv = process.argv) {
	try {
		// Bare `taskgraph` is the help screen, banner included
		if (argv.length <= 2) {
			if (
				ui.shouldShowAsciiBanner(argv.slice(2), Boolean(process.stdout.isTTY))
			) {
				displayBanner();
			}
			displayHelp();
			return;
		}

		// init creates the config, and models and lang edit it and report a
		// missing one as an error, so the "using default settings" warning
		// would only repeat or contradict them
		if (['init', 'models', 'lang', 'merge-driver'].includes(argv[2])) {
			setSuppressConfigWarnings(true);
		}
		// Only the top-level help screen gets the banner; routine commands lead
		// with their result (init prints its own)
		if (
			ui.shouldShowAsciiBanner(argv.slice(2), Boolean(process.stdout.isTTY))
		) {
			displayBanner();
		}

		// Check for updates BEFORE executing the command (skip entirely in test/CI mode)
		// `completion` output is usually redirected into a file, so nothing else
		// may be printed to stdout before or after it
		// The merge driver runs inside `git merge`: no update check, no notices
		// A --json / --format json run prints only its JSON on stdout, for a
		// script or agent to parse
		const printsOnlyItsOwnOutput =
			['completion', 'merge-driver'].includes(argv[2]) ||
			wantsJsonOutput(argv.slice(2));
		const skipAutoUpdate =
			process.env.TASKGRAPH_SKIP_AUTO_UPDATE === '1' ||
			process.env.CI ||
			process.env.NODE_ENV === 'test' ||
			printsOnlyItsOwnOutput;

		const currentVersion = getTaskGraphVersion();
		const updateInfo = skipAutoUpdate
			? { currentVersion, latestVersion: currentVersion, needsUpdate: false }
			: await checkForUpdate(currentVersion);

		if (updateInfo.needsUpdate) {
			// Display the upgrade notification first
			displayUpgradeNotification(
				updateInfo.currentVersion,
				updateInfo.latestVersion,
				updateInfo.highlights
			);

			// Automatically perform the update
			const updateSuccess = await performAutoUpdate(updateInfo.latestVersion);
			if (updateSuccess) {
				// Restart with the new version - this will execute the user's command
				restartWithNewVersion(argv);
				return; // Never reached, but for clarity
			}
			// If update fails, continue with current version
		}

		// Setup and parse
		const programInstance = setupCLI();
		// Filter out --no-banner since it's handled above and not a Commander option
		const filteredArgv = argv.filter((arg) => arg !== '--no-banner');
		await programInstance.parseAsync(filteredArgv);

		// Show the "TaskGraph now supports tags" notice once, after a run that
		// migrated an old tasks.json. It used to show for any project whose
		// state.json said the notice hadn't been shown, which included every
		// new project after its first tasks were created.
		try {
			if (printsOnlyItsOwnOutput) return;
			const statePath = initTaskGraph({}).getStatePath();

			if (statePath && fs.existsSync(statePath)) {
				// Read state.json directly without tag resolution since it's not a tagged file
				const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));

				if (stateData?.migrationNoticePending === true) {
					displayTaggedTasksFYI({ _migrationHappened: true });
					stateData.migrationNoticePending = false;
					stateData.migrationNoticeShown = true;
					fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));
				}
			}
		} catch (error) {
			// Silently ignore errors checking for migration notice
		}
	} catch (error) {
		displayError(error);
	}
}

export { setupCLI, runCLI };
