/**
 * commands.js
 * Command-line interface for the TaskGraph CLI
 */

import fs from 'fs';
import path from 'path';
import { Command } from 'commander';

// Import command registry and utilities from @tm/cli
import {
	aiErrorHint,
	checkForUpdate,
	collectClarifications,
	describeError,
	displayError,
	displayUpgradeNotification,
	formatCommanderError,
	printError,
	performAutoUpdate,
	printJson,
	registerAllCommands,
	restartWithNewVersion,
	ui,
	wantsJsonOutput
} from '@tm/cli';
import { log } from './utils.js';

import { parsePRD } from './task-manager.js';

import { findPrdGaps } from './task-manager/parse-prd/index.js';

import {
	getDefaultNumTasks,
	setSuppressConfigWarnings
} from './config-manager.js';

import {
	parseClarificationAnswers,
	UPSTREAM_DIR,
	UPSTREAM_IMPORT_FLAG,
	UPSTREAM_NAME,
	PROJECT_ROOT_ENV,
	findProjectRoot,
	getOwnKey,
	isTaskGraphProject,
	resolveProjectRoot,
	writeClarifications
} from '@tm/core';

import {
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';

import { initTaskGraph } from '../../src/taskgraph.js';

import {
	confirmTaskOverwrite,
	displayAiUsageSummary,
	displayBanner,
	displayCurrentTagIndicator,
	displayHelp,
	displayTaggedTasksFYI,
	startLoadingIndicator,
	stopLoadingIndicator
} from './ui.js';

import { theme } from '@tm/cli/theme';
import {
	RULE_PROFILES,
	findInvalidRulesProfiles
} from '../../src/constants/profiles.js';
import { getTaskGraphVersion } from '../../src/utils/getVersion.js';
import { initializeProject, setUpMergeDriver } from '../init.js';

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

	// parse-prd command
	programInstance
		.command('parse-prd')
		.description('Parse a PRD file and generate tasks')
		.argument('[file]', 'Path to the PRD file')
		.option(
			'-i, --input <file>',
			'Path to the PRD file (alternative to positional argument)'
		)
		.option('-o, --output <file>', 'Output file path')
		.option(
			'-n, --num-tasks <number>',
			'About how many tasks (default: sized to the PRD)'
		)
		.option('-f, --force', 'Skip confirmation when overwriting existing tasks')
		.option(
			'--append',
			'Append new tasks to existing tasks.json instead of overwriting'
		)
		.option(
			'-r, --research',
			'Use Claude Code web research for research-backed task generation, providing more comprehensive and accurate task breakdown'
		)
		.option(
			'--clarify',
			'Ask up to 5 questions about gaps in the PRD first and save the answers in it'
		)
		.option(
			'--answers <file>',
			'Save answers (JSON from --clarify --json, or - for stdin) in the PRD, then generate tasks'
		)
		.option('--json', 'With --clarify: print the questions as JSON and stop')
		.option('-y, --yes', 'With --clarify: accept the suggested answers')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (file, options) => {
			// Resolve PRD path: prioritize --input option, then positional argument
			const prdPath = options.input || file;

			// A mistyped path is the common failure; say so before anything else
			if (prdPath && !fs.existsSync(path.resolve(prdPath))) {
				printError(
					`${prdPath} not found`,
					'Check the spelling; paths are relative to this folder'
				);
				process.exit(1);
			}

			// Flags that only work together; checked before any AI call or write
			const flagError = clarifyFlagError(options);
			if (flagError) {
				printError(flagError.message, flagError.hint);
				process.exit(1);
			}
			let answersFromFile = null;
			if (
				options.answers &&
				options.answers !== '-' &&
				!fs.existsSync(path.resolve(options.answers))
			) {
				printError(
					`${options.answers} not found`,
					'Check the spelling; paths are relative to this folder'
				);
				process.exit(1);
			}
			if (options.answers) {
				try {
					answersFromFile = readClarificationAnswers(options.answers);
				} catch (error) {
					printError(
						`Couldn't read the answers in ${options.answers}: ${error.message}`,
						'Add an "answer" to each question in the output of --clarify --json'
					);
					process.exit(1);
				}
			}

			// Initialize TaskGraph
			let taskGraph;
			try {
				const initOptions = {
					prdPath: prdPath || true,
					tag: options.tag
				};
				// Only include tasksPath if output is explicitly specified
				if (options.output) {
					initOptions.tasksPath = options.output;
				}
				taskGraph = initTaskGraph(initOptions);
			} catch (error) {
				displayError(error, {
					hint: prdPath ? undefined : 'Try `taskgraph parse-prd prd.md`'
				});
				process.exit(1);
			}

			// Without the flag, the config's defaultNumTasks; 0 sizes it to the PRD
			const numTasks = parseInt(
				options.numTasks ?? getDefaultNumTasks(taskGraph.getProjectRoot()),
				10
			);
			const force = options.force || false;
			const append = options.append || false;
			const research = options.research || false;
			let useForce = force;
			const useAppend = append;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// --clarify --json: print the questions for an agent to ask, and stop.
			// stdout carries only the JSON
			if (options.clarify && options.json) {
				try {
					const { questions } = await findPrdGaps({
						prdPath: taskGraph.getPrdPath(),
						projectRoot: taskGraph.getProjectRoot(),
						research
					});
					printJson({ prd: displayPath(taskGraph.getPrdPath()), questions });
				} catch (error) {
					printError(`Couldn't find questions to ask: ${error.message}`);
					process.exit(1);
				}
				return;
			}

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			// Helper function to check if there are existing tasks in the target tag and confirm overwrite
			async function confirmOverwriteIfNeeded() {
				// Check if there are existing tasks in the target tag
				let hasExistingTasksInTag = false;
				const tasksPath = taskGraph.getTasksPath();
				if (fs.existsSync(tasksPath)) {
					try {
						// Read the entire file to check if the tag exists
						const existingFileContent = fs.readFileSync(tasksPath, 'utf8');
						const allData = JSON.parse(existingFileContent);

						// Check if the target tag exists and has tasks
						const tagTasks = getOwnKey(allData, tag)?.tasks;
						if (Array.isArray(tagTasks) && tagTasks.length > 0) {
							hasExistingTasksInTag = true;
						}
					} catch (error) {
						// If we can't read the file or parse it, assume no existing tasks in this tag
						hasExistingTasksInTag = false;
					}
				}

				// Only show confirmation if there are existing tasks in the target tag
				if (hasExistingTasksInTag && !useForce && !useAppend) {
					const overwrite = await confirmTaskOverwrite(tasksPath);
					if (!overwrite) {
						console.log(theme.muted('Cancelled; no tasks changed'));
						return false;
					}
					// If user confirms 'y', we should set useForce = true for the parsePRD call
					// Only overwrite if not appending
					useForce = true;
				}
				return true;
			}

			try {
				if (!(await confirmOverwriteIfNeeded())) return;

				// Answers go into the PRD first, so the tasks are generated from them
				const answers =
					answersFromFile ??
					(options.clarify
						? await clarifyPrd(taskGraph, { research, yes: options.yes })
						: []);
				if (answers.length > 0) {
					const saved = writeClarifications(taskGraph.getPrdPath(), answers);
					console.log(
						ui.formatClarificationsSaved(
							saved,
							displayPath(taskGraph.getPrdPath())
						)
					);
				}

				// The progress display names the file, task count and research,
				// and the saved line the new total, so no preamble
				// Handle case where getTasksPath() returns null
				const outputPath =
					taskGraph.getTasksPath() ||
					path.join(taskGraph.getProjectRoot(), TASKGRAPH_TASKS_FILE);
				await parsePRD(taskGraph.getPrdPath(), outputPath, numTasks, {
					append: useAppend,
					force: useForce,
					research: research,
					projectRoot: taskGraph.getProjectRoot(),
					tag: tag
				});
			} catch (error) {
				const { message, hint } = describeError(error, aiErrorHint(error));
				printError(`Couldn't generate tasks: ${message}`, hint);
				process.exit(1);
			}
		});

	// ========================================
	// Register All Commands from @tm/cli
	// ========================================
	// Use the centralized command registry to register all CLI commands
	// This replaces individual command registrations and reduces duplication
	registerAllCommands(programInstance);

	// init command (Directly calls the implementation from init.js)
	programInstance
		.command('init')
		.description('Initialize a new project with TaskGraph structure')
		.option('-y, --yes', 'Skip prompts and use default values')
		.option('-n, --name <name>', 'Project name')
		.option('-d, --description <description>', 'Project description')
		.option('-v, --version <version>', 'Project version', '0.1.0') // Set default here
		.option('-a, --author <author>', 'Author name')
		.option(
			'-r, --rules <rules...>',
			'Rule profiles to install (claude). Accepts comma or space separated values.'
		)
		.option('--claude', 'Set up Claude Code integration (the default)')
		.option(
			'--no-claude',
			'Skip the Claude Code integration (CLAUDE.md import)'
		)
		.option(
			'--mcp',
			'Also register the TaskGraph MCP server in .mcp.json (Claude Code)'
		)
		.option('--skip-install', 'Skip installing dependencies')
		.option('--dry-run', 'Show what would be done without making changes')
		.option('--aliases', 'Add the tm alias to your shell startup file')
		.option('--no-aliases', "Don't add the tm alias, and don't ask")
		.option('--git', 'Initialize Git repository')
		.option('--no-git', 'Skip Git repository initialization')
		.option('--git-tasks', 'Store tasks in Git')
		.option('--no-git-tasks', 'No Git storage of tasks')
		.option(
			'--merge-driver',
			'Only set up Git to merge tasks.json by task (existing projects)'
		)
		.option(
			UPSTREAM_IMPORT_FLAG,
			`Import a ${UPSTREAM_NAME} project (${UPSTREAM_DIR}/)`
		)
		.action(async (cmdOptions) => {
			if (cmdOptions.mergeDriver) {
				const root = findProjectRoot() || process.cwd();
				try {
					console.log(ui.formatMergeDriverSetup(setUpMergeDriver(root)));
				} catch (error) {
					if (error?.name === 'NotAGitRepositoryError') {
						printError(
							"This folder isn't in a Git repository",
							'Run `git init` first, then `taskgraph init --merge-driver`'
						);
					} else {
						printError(
							`Couldn't set up the tasks.json merge driver: ${error.message}`
						);
					}
					process.exit(1);
				}
				return;
			}

			// cmdOptions contains parsed arguments
			// Parse rules: accept space or comma separated, default to all available rules
			let selectedProfiles = RULE_PROFILES;
			let rulesExplicitlyProvided = false;

			if (cmdOptions.rules && Array.isArray(cmdOptions.rules)) {
				const userSpecifiedProfiles = cmdOptions.rules
					.flatMap((r) => r.split(','))
					.map((r) => r.trim())
					.filter(Boolean);
				// Only override defaults if user specified valid rules
				const invalidProfiles = findInvalidRulesProfiles(userSpecifiedProfiles);
				if (invalidProfiles.length > 0) {
					printError(
						`"${invalidProfiles.join(', ')}" isn't a rule profile`,
						`TaskGraph supports Claude Code only; use \`--rules ${RULE_PROFILES.join(',')}\``
					);
					process.exit(1);
				}
				if (userSpecifiedProfiles.length > 0) {
					selectedProfiles = userSpecifiedProfiles;
					rulesExplicitlyProvided = true;
				}
			}

			if (cmdOptions.mcp && cmdOptions.claude === false) {
				printError(
					'--mcp writes Claude Code’s .mcp.json, so it needs the Claude Code integration',
					'Drop --no-claude, or drop --mcp'
				);
				process.exit(1);
			}

			cmdOptions.rules = selectedProfiles;
			cmdOptions.rulesExplicitlyProvided = rulesExplicitlyProvided;

			try {
				// Directly call the initializeProject function, passing the parsed options
				await initializeProject(cmdOptions);
				// initializeProject handles its own flow, including potential process.exit()
			} catch (error) {
				displayError(error);
			}
		});

	return programInstance;
}

/**
 * parse-prd's --clarify flags that need each other, or exclude each other
 * @returns {{message: string, hint: string} | null}
 */
function clarifyFlagError(options) {
	if (options.clarify && options.answers) {
		return {
			message: '--clarify and --answers both supply the answers',
			hint: 'Use --clarify to be asked, or --answers <file> to pass them in'
		};
	}
	if (options.json && !options.clarify) {
		return {
			message: '--json only works with --clarify',
			hint: 'Try `taskgraph parse-prd prd.md --clarify --json`'
		};
	}
	if (options.yes && !options.clarify) {
		return {
			message: '--yes only works with --clarify',
			hint: 'Try `taskgraph parse-prd prd.md --clarify --yes`'
		};
	}
	return null;
}

/** Read --answers: a JSON file, or - for stdin */
function readClarificationAnswers(source) {
	const text =
		source === '-'
			? fs.readFileSync(0, 'utf8')
			: fs.readFileSync(source, 'utf8');
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		throw new Error("it isn't valid JSON");
	}
	return parseClarificationAnswers(json);
}

/** A path as the user typed it: relative to the current folder */
function displayPath(file) {
	const relative = path.relative(process.cwd(), file);
	return relative && !relative.startsWith('..') ? relative : file;
}

/**
 * parse-prd --clarify in the terminal: find gaps in the PRD, then ask about
 * them (or take the suggested answers without a terminal or with --yes)
 * @returns {Promise<Array<{question: string, answer: string}>>}
 */
async function clarifyPrd(taskGraph, { research, yes }) {
	const prdPath = taskGraph.getPrdPath();
	const prdName = displayPath(prdPath);
	const spinner = startLoadingIndicator(`Reading ${prdName} for gaps…`);
	let questions;
	try {
		({ questions } = await findPrdGaps({
			prdPath,
			projectRoot: taskGraph.getProjectRoot(),
			research
		}));
	} finally {
		stopLoadingIndicator(spinner);
	}

	if (questions.length === 0) {
		console.log(ui.formatNoClarifyQuestions(prdName));
		return [];
	}
	const answers = await collectClarifications(questions, { prdName, yes });
	if (answers === null) {
		console.log(ui.formatClarifyCancelled(prdName));
		process.exit(130);
	}
	return answers;
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
