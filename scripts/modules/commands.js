/**
 * commands.js
 * Command-line interface for the TaskGraph CLI
 */

import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import inquirer from 'inquirer';

// Import command registry and utilities from @tm/cli
import {
	checkForUpdate,
	collectClarifications,
	displayError,
	displayUpgradeNotification,
	formatCommanderError,
	fromBranchError,
	printError,
	performAutoUpdate,
	printJson,
	registerAllCommands,
	restartWithNewVersion,
	runInteractiveSetup,
	ui,
	wantsJsonOutput
} from '@tm/cli';
import { syncTasksToReadme } from './sync-readme.js';
import { log, readJSON } from './utils.js';

import {
	addSubtask,
	addTask,
	analyzeTaskComplexity,
	clearSubtasks,
	expandAllTasks,
	expandTask,
	findTaskById,
	moveTask,
	parsePRD,
	removeSubtask,
	removeTask,
	scopeDownTask,
	scopeUpTask,
	setResponseLanguage,
	taskExists,
	updateSubtaskById,
	updateTaskById,
	updateTasks,
	validateStrength
} from './task-manager.js';

import { moveTasksBetweenTags } from './task-manager/move-task.js';
import { findPrdGaps } from './task-manager/parse-prd/index.js';

import {
	getAvailableModelsList,
	getModelConfiguration,
	setModel
} from './task-manager/models.js';

import {
	copyTag,
	createTag,
	deleteTag,
	renameTag,
	tags,
	useTag
} from './task-manager/tag-management.js';

import {
	addDependency,
	DependencyError,
	fixDependenciesCommand,
	removeDependency,
	validateDependenciesCommand
} from './dependency-manager.js';

import {
	getConfig,
	getDefaultNumTasks,
	getResponseLanguage,
	isConfigFilePresent,
	setSuppressConfigWarnings
} from './config-manager.js';

import {
	CUSTOM_PROVIDERS,
	createTagFromBranch,
	parseClarificationAnswers,
	UPSTREAM_DIR,
	UPSTREAM_IMPORT_FLAG,
	UPSTREAM_NAME,
	PROJECT_ROOT_ENV,
	findProjectRoot,
	getOwnKey,
	isTaskGraphProject,
	parseSubtaskDependencyInput,
	resolveProjectRoot,
	writeClarifications
} from '@tm/core';

import {
	COMPLEXITY_REPORT_FILE,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';

import { initTaskGraph } from '../../src/taskgraph.js';

import {
	confirmTaskOverwrite,
	displayBanner,
	displayComplexityReport,
	displayCrossTagDependencyError,
	displayCurrentTagIndicator,
	displayDependencyValidationHints,
	displayHelp,
	displayInvalidTagCombinationError,
	displaySubtaskMoveError,
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
 * The next step to suggest when an AI-backed command fails for a reason the
 * user can act on. Returns undefined to fall back to the default hint for
 * the error (e.g. listing tasks when an ID isn't found).
 * @param {Error} error
 * @returns {string|undefined}
 */
function aiErrorHint(error) {
	const message = error?.message ?? '';
	if (/overloaded|rate limit|\b(429|529)\b/i.test(message)) {
		return 'Claude is busy. Wait a minute and try again';
	}
	if (/empty stream response|did not return a valid/i.test(message)) {
		return 'Try again, or reword the prompt';
	}
	return undefined;
}

/**
 * Run a dependency command. Its DependencyError (no tasks, task not found, a
 * loop, ...) is printed as a message with its hint and ends the command with
 * exit code 1, not as a stack trace. Anything else is rethrown.
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 * @template T
 */
async function reportDependencyErrors(run) {
	try {
		return await run();
	} catch (error) {
		if (!(error instanceof DependencyError)) throw error;
		printError(error.message, error.data?.hint);
		process.exit(1);
	}
}

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
				console.error(chalk.red(`Error parsing PRD: ${error.message}`));
				process.exit(1);
			}
		});

	// update command
	programInstance
		.command('update')
		.description(
			'Update multiple tasks with ID >= "from" based on new information or implementation changes'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'--from <id>',
			'Task ID to start updating from (tasks with ID >= this value will be updated)',
			'1'
		)
		.option(
			'-p, --prompt <text>',
			'Prompt explaining the changes or new context (required)'
		)
		.option(
			'-r, --research',
			'Use Claude Code web research for research-backed task updates'
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const fromId = parseInt(options.from, 10); // Validation happens here
			const prompt = options.prompt;
			const useResearch = options.research || false;

			const tasksPath = taskGraph.getTasksPath();

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			// Check if there's an 'id' option which is a common mistake (instead of 'from')
			if (
				process.argv.includes('--id') ||
				process.argv.some((arg) => arg.startsWith('--id='))
			) {
				console.error(
					chalk.red('Error: The update command uses --from=<id>, not --id=<id>')
				);
				console.log(chalk.yellow('\nTo update multiple tasks:'));
				console.log(
					`  taskgraph update --from=${fromId} --prompt="Your prompt here"`
				);
				console.log(
					chalk.yellow(
						'\nTo update a single specific task, use the update-task command instead:'
					)
				);
				console.log(
					`  taskgraph update-task --id=<id> --prompt="Your prompt here"`
				);
				process.exit(1);
			}

			if (!prompt) {
				console.error(
					chalk.red(
						'Error: --prompt parameter is required. Please provide information about the changes.'
					)
				);
				process.exit(1);
			}

			try {
				await updateTasks(
					taskGraph.getTasksPath(),
					fromId,
					prompt,
					useResearch,
					{ projectRoot: taskGraph.getProjectRoot(), tag }
				);
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// update-task command
	programInstance
		.command('update-task')
		.description('Update a single specific task by ID with new information')
		.argument('[id]', 'Task ID to update (e.g., 1, 1.1, TAS-123)')
		.argument('[prompt...]', 'Update prompt - multiple words, no quotes needed')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-i, --id <id>',
			'Task ID to update (fallback if not using positional)'
		)
		.option('-p, --prompt <text>', 'Prompt (fallback if not using positional)')
		.option(
			'-r, --research',
			'Use Claude Code web research for research-backed task updates'
		)
		.option(
			'--append',
			'Append timestamped information to task details instead of full update'
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (idArg, promptWords, options) => {
			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true,
					tag: options.tag
				});
				const tasksPath = taskGraph.getTasksPath();

				// Resolve tag using standard pattern
				const tag = taskGraph.getCurrentTag();

				// Show current tag context
				await displayCurrentTagIndicator(tag, {
					tasksPath: taskGraph.getTasksPath()
				});

				// Prioritize positional arguments over options
				const taskId = idArg || options.id;
				const prompt =
					promptWords.length > 0 ? promptWords.join(' ') : options.prompt;

				// Validate required parameters
				if (!taskId) {
					printError(
						'Missing task ID',
						'Try `taskgraph update-task --id=3 --prompt="what changed"`'
					);
					process.exit(1);
				}

				// Validate the task ID is a positive integer (e.g. 1,2,3)
				// Disallow decimals and invalid formats
				const validId = /^\d+$/.test(taskId);

				if (!validId) {
					printError(
						`"${taskId}" isn't a task ID`,
						taskId.includes('.')
							? 'Update subtasks with `taskgraph update-subtask`'
							: 'Use a number like `3`'
					);
					process.exit(1);
				}

				if (!prompt) {
					printError(
						'Missing prompt',
						`Try \`taskgraph update-task --id=${taskId} --prompt="what changed"\``
					);
					process.exit(1);
				}
				const useResearch = options.research || false;

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
					if (tasksPath === TASKGRAPH_TASKS_FILE) {
						console.log(
							chalk.yellow(
								'Hint: Run taskgraph init or taskgraph parse-prd to create tasks.json first'
							)
						);
					} else {
						console.log(
							chalk.yellow(
								`Hint: Check if the file path is correct: ${tasksPath}`
							)
						);
					}
					process.exit(1);
				}

				const shouldAppend = options.append || false;

				const result = await updateTaskById(
					taskGraph.getTasksPath(),
					taskId,
					prompt,
					useResearch,
					{ projectRoot: taskGraph.getProjectRoot(), tag },
					'text',
					shouldAppend
				);

				// updateTaskById returns null only for a finished task
				if (!result) {
					printError(
						`Task ${taskId} is done, so it can't be updated`,
						`Run \`taskgraph set-status --id=${taskId} --status=pending\` first`
					);
					process.exitCode = 1;
				}
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// update-subtask command
	programInstance
		.command('update-subtask')
		.description(
			'Update a subtask by appending additional timestamped information'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-i, --id <id>', 'Subtask ID to update (required)')
		.option(
			'-p, --prompt <text>',
			'Prompt explaining what information to add (required)'
		)
		.option(
			'-r, --research',
			'Use Claude Code web research for research-backed updates'
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true,
					tag: options.tag
				});
				const tasksPath = taskGraph.getTasksPath();

				// Resolve tag using standard pattern
				const tag = taskGraph.getCurrentTag();

				// Show current tag context
				await displayCurrentTagIndicator(tag, {
					tasksPath: taskGraph.getTasksPath()
				});

				// Validate required parameters
				if (!options.id) {
					console.error(chalk.red('Error: --id parameter is required'));
					console.log(
						chalk.yellow(
							'Usage example: taskgraph update-subtask --id=5.2 --prompt="Add more details about the API endpoint"'
						)
					);
					process.exit(1);
				}

				// Get subtask ID - validation happens in the core function
				// Subtask IDs must be in format "parentId.subtaskId"
				const subtaskId = options.id;

				if (!options.prompt) {
					console.error(
						chalk.red(
							'Error: --prompt parameter is required. Please provide information to add to the subtask.'
						)
					);
					console.log(
						chalk.yellow(
							'Usage example: taskgraph update-subtask --id=5.2 --prompt="Add more details about the API endpoint"'
						)
					);
					process.exit(1);
				}

				const prompt = options.prompt;
				const useResearch = options.research || false;

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
					if (tasksPath === TASKGRAPH_TASKS_FILE) {
						console.log(
							chalk.yellow(
								'Hint: Run taskgraph init or taskgraph parse-prd to create tasks.json first'
							)
						);
					} else {
						console.log(
							chalk.yellow(
								`Hint: Check if the file path is correct: ${tasksPath}`
							)
						);
					}
					process.exit(1);
				}

				await updateSubtaskById(
					taskGraph.getTasksPath(),
					subtaskId,
					prompt,
					useResearch,
					{ projectRoot: taskGraph.getProjectRoot(), tag }
				);
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// scope-up command
	programInstance
		.command('scope-up')
		.description('Increase task complexity with AI assistance')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-i, --id <ids>',
			'Comma-separated task/subtask IDs to scope up (required)'
		)
		.option(
			'-s, --strength <level>',
			'Complexity increase strength: light, regular, heavy',
			'regular'
		)
		.option(
			'-p, --prompt <text>',
			'Custom instructions for targeted scope adjustments'
		)
		.option('-r, --research', 'Use research AI for more informed adjustments')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true,
					tag: options.tag
				});
				const tasksPath = taskGraph.getTasksPath();
				const tag = taskGraph.getCurrentTag();

				// Show current tag context
				await displayCurrentTagIndicator(tag, {
					tasksPath: taskGraph.getTasksPath()
				});

				// Validate required parameters
				if (!options.id) {
					console.error(chalk.red('Error: --id parameter is required'));
					console.log(
						chalk.yellow(
							'Usage example: taskgraph scope-up --id=1,2,3 --strength=regular'
						)
					);
					process.exit(1);
				}

				// Parse and validate task IDs
				const taskIds = options.id.split(',').map((id) => {
					const parsed = parseInt(id.trim(), 10);
					if (Number.isNaN(parsed) || parsed <= 0) {
						console.error(chalk.red(`Error: Invalid task ID: ${id.trim()}`));
						process.exit(1);
					}
					return parsed;
				});

				// Validate strength level
				if (!validateStrength(options.strength)) {
					console.error(
						chalk.red(
							`Error: Invalid strength level: ${options.strength}. Must be one of: light, regular, heavy`
						)
					);
					process.exit(1);
				}

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
					process.exit(1);
				}

				console.log(
					theme.brand(
						`Scoping up ${taskIds.length === 1 ? 'task' : 'tasks'} ${taskIds.join(', ')}`
					)
				);

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					tag,
					commandName: 'scope-up',
					outputType: 'cli',
					research: options.research || false
				};

				const result = await scopeUpTask(
					tasksPath,
					taskIds,
					options.strength,
					options.prompt || null,
					context,
					'text'
				);

				console.log(
					chalk.green(
						`✓ Scoped up ${result.updatedTasks.length} ${result.updatedTasks.length === 1 ? 'task' : 'tasks'}`
					)
				);
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// scope-down command
	programInstance
		.command('scope-down')
		.description('Decrease task complexity with AI assistance')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-i, --id <ids>',
			'Comma-separated task/subtask IDs to scope down (required)'
		)
		.option(
			'-s, --strength <level>',
			'Complexity decrease strength: light, regular, heavy',
			'regular'
		)
		.option(
			'-p, --prompt <text>',
			'Custom instructions for targeted scope adjustments'
		)
		.option('-r, --research', 'Use research AI for more informed adjustments')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true,
					tag: options.tag
				});
				const tasksPath = taskGraph.getTasksPath();
				const tag = taskGraph.getCurrentTag();

				// Show current tag context
				await displayCurrentTagIndicator(tag, {
					tasksPath: taskGraph.getTasksPath()
				});

				// Validate required parameters
				if (!options.id) {
					console.error(chalk.red('Error: --id parameter is required'));
					console.log(
						chalk.yellow(
							'Usage example: taskgraph scope-down --id=1,2,3 --strength=regular'
						)
					);
					process.exit(1);
				}

				// Parse and validate task IDs
				const taskIds = options.id.split(',').map((id) => {
					const parsed = parseInt(id.trim(), 10);
					if (Number.isNaN(parsed) || parsed <= 0) {
						console.error(chalk.red(`Error: Invalid task ID: ${id.trim()}`));
						process.exit(1);
					}
					return parsed;
				});

				// Validate strength level
				if (!validateStrength(options.strength)) {
					console.error(
						chalk.red(
							`Error: Invalid strength level: ${options.strength}. Must be one of: light, regular, heavy`
						)
					);
					process.exit(1);
				}

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
					process.exit(1);
				}

				console.log(
					theme.brand(
						`Scoping down ${taskIds.length === 1 ? 'task' : 'tasks'} ${taskIds.join(', ')}`
					)
				);

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					tag,
					commandName: 'scope-down',
					outputType: 'cli',
					research: options.research || false
				};

				const result = await scopeDownTask(
					tasksPath,
					taskIds,
					options.strength,
					options.prompt || null,
					context,
					'text'
				);

				console.log(
					chalk.green(
						`✓ Scoped down ${result.updatedTasks.length} ${result.updatedTasks.length === 1 ? 'task' : 'tasks'}`
					)
				);
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// ========================================
	// Register All Commands from @tm/cli
	// ========================================
	// Use the centralized command registry to register all CLI commands
	// This replaces individual command registrations and reduces duplication
	registerAllCommands(programInstance);

	// expand command
	programInstance
		.command('expand')
		.description('Expand a task into subtasks using AI')
		.option('-i, --id <id>', 'ID of the task to expand')
		.option(
			'-a, --all',
			'Expand all pending tasks based on complexity analysis'
		)
		.option(
			'-n, --num <number>',
			'Number of subtasks to generate (uses complexity analysis by default if available)'
		)
		.option(
			'-r, --research',
			'Enable research-backed generation (web research via Claude Code)',
			false
		)
		.option('-p, --prompt <text>', 'Additional context for subtask generation')
		.option('-f, --force', 'Force expansion even if subtasks exist', false) // Ensure force option exists
		.option(
			'--file <file>',
			'Path to the tasks file (relative to project root)',
			TASKGRAPH_TASKS_FILE // Allow file override
		) // Allow file override
		.option(
			'--complexity-report <file>',
			'Path to the complexity report file (use this to specify the complexity report, not --file)'
			// Removed default value to allow tag-specific auto-detection
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			if (options.complexityReport) {
				initOptions.complexityReportPath = options.complexityReport;
			}

			const taskGraph = initTaskGraph(initOptions);

			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			if (options.all) {
				// --- Handle expand --all ---
				// Each task's spinner and result, then one summary line, say it all
				try {
					const result = await expandAllTasks(
						taskGraph.getTasksPath(),
						options.num, // Pass num
						options.research, // Pass research flag
						options.prompt, // Pass additional context
						options.force, // Pass force flag
						{
							projectRoot: taskGraph.getProjectRoot(),
							tag,
							complexityReportPath: taskGraph.getComplexityReportPath()
						} // Pass context with projectRoot and tag
						// outputFormat defaults to 'text' in expandAllTasks for CLI
					);
					// Some tasks failed: the work that succeeded is saved, but the
					// run did not do everything asked
					if (result?.failedCount > 0) process.exitCode = 1;
				} catch (error) {
					displayError(error, { hint: aiErrorHint(error) });
				}
			} else if (options.id) {
				// --- Handle expand --id <id> (Should be correct from previous refactor) ---
				if (!options.id) {
					console.error(
						chalk.red('Error: Task ID is required unless using --all.')
					);
					process.exit(1);
				}

				try {
					// Call the refactored expandTask function
					await expandTask(
						taskGraph.getTasksPath(),
						options.id,
						options.num,
						options.research,
						options.prompt,
						{
							projectRoot: taskGraph.getProjectRoot(),
							tag,
							complexityReportPath: taskGraph.getComplexityReportPath()
						}, // Pass context with projectRoot and tag
						options.force // Pass the force flag down
					);
					// expandTask logs its own success/failure for single task
				} catch (error) {
					displayError(error, { hint: aiErrorHint(error) });
				}
			} else {
				printError(
					'Missing task ID',
					'Try `taskgraph expand --id=3`, or `--all` for every pending task'
				);
				process.exit(1);
			}
		});

	// analyze-complexity command
	programInstance
		.command('analyze-complexity')
		.description(
			`Analyze tasks and generate expansion recommendations${chalk.reset('')}`
		)
		.option('-o, --output <file>', 'Output file path for the report')
		.option(
			'-m, --model <model>',
			'LLM model to use for analysis (defaults to configured model)'
		)
		.option(
			'-t, --threshold <number>',
			'Minimum complexity score to recommend expansion (1-10)',
			'5'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-r, --research',
			'Use configured research model for research-backed complexity analysis'
		)
		.option(
			'-i, --id <ids>',
			'Comma-separated list of specific task IDs to analyze (e.g., "1,3,5")'
		)
		.option('--from <id>', 'Starting task ID in a range to analyze')
		.option('--to <id>', 'Ending task ID in a range to analyze')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const initOptions = {
				tasksPath: options.file || true, // Tasks file is required to analyze
				tag: options.tag
			};
			// Only include complexityReportPath if output is explicitly specified
			if (options.output) {
				initOptions.complexityReportPath = options.output;
			}

			const taskGraph = initTaskGraph(initOptions);

			// Use the provided tag, or the current active tag, or default to 'master'
			const targetTag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(targetTag, {
				tasksPath: taskGraph.getTasksPath()
			});

			// Use user's explicit output path if provided, otherwise use tag-aware default
			const outputPath = taskGraph.getComplexityReportPath();

			// The spinner and the summary say what's analyzed and where the
			// report goes; no separate lines with absolute paths up front
			// Update options with tag-aware output path and context
			const updatedOptions = {
				...options,
				output: outputPath,
				tag: targetTag,
				projectRoot: taskGraph.getProjectRoot(),
				file: taskGraph.getTasksPath()
			};

			await analyzeTaskComplexity(updatedOptions);
		});

	// research command
	programInstance
		.command('research')
		.description('Perform AI-powered research queries with project context')
		.argument('[prompt]', 'Research prompt to investigate')
		.option('--file <file>', 'Path to the tasks file')
		.option(
			'-i, --id <ids>',
			'Comma-separated task/subtask IDs to include as context (e.g., "15,16.2")'
		)
		.option(
			'-f, --files <paths>',
			'Comma-separated file paths to include as context'
		)
		.option(
			'-c, --context <text>',
			'Additional custom context to include in the research prompt'
		)
		.option(
			'-t, --tree',
			'Include project file tree structure in the research context'
		)
		.option('-s, --save <file>', 'Save the answer to a markdown file')
		.option(
			'-d, --detail <level>',
			'Output detail level: low, medium, high',
			'medium'
		)
		.option(
			'--save-to <id>',
			'Add the answer to a task or subtask\'s details (e.g., "15" or "15.2")'
		)
		.option('--save-file', 'Save the answer to .taskgraph/docs/research/')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (prompt, options) => {
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});
			const fail = (message, hint) => {
				printError(message, hint);
				process.exit(1);
			};
			const isTaskId = (id) => /^\d+(\.\d+)?$/.test(id);

			if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
				fail(
					'Research needs a question',
					'Example: taskgraph research "How should we store sessions?" --id=3'
				);
			}

			const detailLevel = (options.detail || 'medium').toLowerCase();
			if (!['low', 'medium', 'high'].includes(detailLevel)) {
				fail(`--detail must be low, medium or high, not "${options.detail}"`);
			}

			const taskIds = options.id
				? options.id
						.split(',')
						.map((id) => id.trim())
						.filter(Boolean)
				: [];
			const badId = taskIds.find((id) => !isTaskId(id));
			if (badId) {
				fail(`"${badId}" isn't a task ID`, 'Use --id=15 or --id=15,16.2');
			}

			const filePaths = options.files
				? options.files
						.split(',')
						.map((file) => file.trim())
						.filter(Boolean)
				: [];

			const saveToId = options.saveTo ? options.saveTo.trim() : null;
			if (options.saveTo !== undefined && !isTaskId(saveToId || '')) {
				fail(
					`"${options.saveTo}" isn't a task ID`,
					'Use --save-to=15 for a task or --save-to=15.2 for a subtask'
				);
			}

			const saveTarget = options.save ? options.save.trim() : null;
			if (
				options.save !== undefined &&
				(!saveTarget ||
					saveTarget.includes('..') ||
					path.isAbsolute(saveTarget))
			) {
				fail('--save needs a relative file path without ".."');
			}

			const tag = taskGraph.getCurrentTag();
			const projectRoot = taskGraph.getProjectRoot();
			const tasksPath = taskGraph.getTasksPath();

			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			// Check every task ID before spending an AI call
			const idsToCheck = [...taskIds, ...(saveToId ? [saveToId] : [])];
			if (idsToCheck.length > 0) {
				const tasks = readJSON(tasksPath, projectRoot, tag)?.tasks || [];
				const exists = (id) => {
					const [parentId, subtaskId] = id
						.split('.')
						.map((part) => Number.parseInt(part, 10));
					const parent = tasks.find((task) => Number(task.id) === parentId);
					if (!parent || subtaskId === undefined) return Boolean(parent);
					return (parent.subtasks || []).some(
						(subtask) => Number(subtask.id) === subtaskId
					);
				};
				const missing = idsToCheck.find((id) => !exists(id));
				if (missing) {
					fail(
						`${missing.includes('.') ? 'Subtask' : 'Task'} ${missing} doesn't exist in tag '${tag}'`,
						'Run `taskgraph list` to see task IDs'
					);
				}
			}

			const missingFile = filePaths.find(
				(file) =>
					!fs.existsSync(
						path.isAbsolute(file) ? file : path.join(projectRoot, file)
					)
			);
			if (missingFile) {
				fail(`File not found: ${missingFile}`);
			}

			const query = prompt.trim();
			let result;
			try {
				const { performResearch } = await import('./task-manager/research.js');
				result = await performResearch(
					query,
					{
						taskIds,
						filePaths,
						customContext: options.context ? options.context.trim() : '',
						includeProjectTree: !!options.tree,
						detailLevel,
						projectRoot,
						saveToFile: !!options.saveFile,
						tag
					},
					{ commandName: 'research', outputType: 'cli', tag },
					'text',
					true // follow-up questions, when there's a terminal
				);
			} catch (error) {
				fail(`Research failed: ${error.message}`);
			}

			// --save-to, unless you already saved from the follow-up menu
			if (saveToId && !result.interactiveSaveOccurred) {
				const target = { kind: 'task', id: saveToId };
				try {
					const { appendResearchToTask } = await import(
						'./task-manager/research.js'
					);
					appendResearchToTask(
						tasksPath,
						saveToId,
						`## Research: ${query}\n\n${result.result}`,
						{ projectRoot, tag }
					);
					console.log(ui.formatResearchSaved(target));
				} catch (error) {
					console.log(ui.formatResearchSaveFailed(target, error.message));
					process.exitCode = 1;
				}
			}

			// --save <file>
			if (saveTarget) {
				const target = { kind: 'file', path: saveTarget };
				try {
					fs.writeFileSync(
						saveTarget,
						`# Research: ${query}\n\n${result.result}\n`,
						'utf-8'
					);
					console.log(ui.formatResearchSaved(target));
				} catch (error) {
					console.log(ui.formatResearchSaveFailed(target, error.message));
					process.exitCode = 1;
				}
			}
		});

	// clear-subtasks command
	programInstance
		.command('clear-subtasks')
		.description('Clear subtasks from specified tasks')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-i, --id <ids>',
			'Task IDs (comma-separated) to clear subtasks from'
		)
		.option('--all', 'Clear subtasks from all tasks')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			if (!options.id && !options.all) {
				printError(
					'Choose which tasks to clear',
					'Use `--id=<ids>`, such as `--id=3,5`, or `--all`'
				);
				process.exit(1);
			}

			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});
			const tag = taskGraph.getCurrentTag();
			const tasksPath = taskGraph.getTasksPath();
			const projectRoot = taskGraph.getProjectRoot();

			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			let taskIds = options.id;
			if (options.all) {
				const data = readJSON(tasksPath, projectRoot, tag);
				taskIds = (data?.tasks ?? []).map((t) => t.id).join(',');
				if (!taskIds) {
					console.log('No subtasks to clear');
					return;
				}
			}

			try {
				const result = clearSubtasks(tasksPath, taskIds, { projectRoot, tag });
				console.log(ui.formatClearedSubtasks(result));
			} catch (error) {
				if (error?.name !== 'ClearSubtasksError') throw error;
				const hints = {
					SUBTASK_ID: `Use \`taskgraph remove-subtask --id=${error.taskId}\` for one subtask, or \`--id=${String(error.taskId).split('.')[0]}\` for all`,
					INVALID_TASK_ID: 'Use task numbers, such as `--id=3,5`',
					TASK_NOT_FOUND: 'Run `taskgraph list` to see task IDs',
					NO_TASKS: `Run \`taskgraph list\` to check the "${tag}" tag`
				};
				printError(`${error.message}; nothing was cleared`, hints[error.code]);
				process.exit(1);
			}
		});

	// add-task command
	programInstance
		.command('add-task')
		.description('Add a new task using AI, optionally providing manual details')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-p, --prompt <prompt>',
			'Description of the task to add (required if not using manual fields)'
		)
		.option('-t, --title <title>', 'Task title (for manual task creation)')
		.option(
			'-d, --description <description>',
			'Task description (for manual task creation)'
		)
		.option(
			'--details <details>',
			'Implementation details (for manual task creation)'
		)
		.option(
			'--dependencies <dependencies>',
			'Comma-separated list of task IDs this task depends on'
		)
		.option(
			'--discovered-from <id>',
			'Task you found this work while doing; links them without blocking'
		)
		.option(
			'--priority <priority>',
			'Task priority (high, medium, low)',
			'medium'
		)
		.option(
			'-r, --research',
			'Whether to use research capabilities for task creation'
		)
		.option(
			'--ac <criterion>',
			'Acceptance criterion; repeat for more (set-status --check ticks them)',
			(value, previous = []) => [...previous, value]
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const isManualCreation = options.title && options.description;

			// Validate that either prompt or title+description are provided
			if (!options.prompt && !isManualCreation) {
				console.error(
					chalk.red(
						'Error: Either --prompt or both --title and --description must be provided'
					)
				);
				process.exit(1);
			}

			// No check that tasks.json exists: addTask creates it for the first
			// task. The old check also resolved the path from the current folder,
			// so it failed in any subfolder of the project.
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const projectRoot = taskGraph.getProjectRoot();

			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			let manualTaskData = null;
			if (isManualCreation) {
				manualTaskData = {
					title: options.title,
					description: options.description,
					details: options.details || '',
					testStrategy: options.testStrategy || ''
				};
			}

			const dependenciesArray = options.dependencies
				? options.dependencies.split(',').map((id) => id.trim())
				: [];

			const context = {
				projectRoot,
				tag,
				commandName: 'add-task',
				outputType: 'cli'
			};

			try {
				const { newTaskId, telemetryData } = await addTask(
					taskGraph.getTasksPath(),
					options.prompt,
					dependenciesArray,
					options.priority,
					context,
					'text',
					manualTaskData,
					options.research,
					{
						acceptanceCriteria: options.ac,
						discoveredFrom: options.discoveredFrom
					}
				);

				// addTask handles detailed CLI success logging AND telemetry display when outputFormat is 'text'
				// No need to call displayAiUsageSummary here anymore.
			} catch (error) {
				displayError(error, { hint: error.hint ?? aiErrorHint(error) });
			}
		});

	// add-dependency command
	programInstance
		.command('add-dependency')
		.description('Add a dependency to a task')
		.option('-i, --id <id>', 'Task ID to add dependency to')
		.option('-d, --depends-on <id>', 'Task ID that will become a dependency')
		.option(
			'--type <type>',
			'blocks (default), or related / discovered-from to link without blocking'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			// Initialize TaskGraph
			const taskGraph = initTaskGraph(initOptions);

			const taskId = options.id;
			const dependencyId = options.dependsOn;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			if (!taskId || !dependencyId) {
				console.error(
					chalk.red('Error: Both --id and --depends-on are required')
				);
				process.exit(1);
			}

			// Handle subtask IDs correctly by preserving the string format for IDs containing dots
			// Only use parseInt for simple numeric IDs
			const formattedTaskId = taskId.includes('.')
				? taskId
				: parseInt(taskId, 10);
			const formattedDependencyId = dependencyId.includes('.')
				? dependencyId
				: parseInt(dependencyId, 10);

			await reportDependencyErrors(() =>
				addDependency(
					taskGraph.getTasksPath(),
					formattedTaskId,
					formattedDependencyId,
					{
						projectRoot: taskGraph.getProjectRoot(),
						tag,
						linkType: options.type
					}
				)
			);
		});

	// remove-dependency command
	programInstance
		.command('remove-dependency')
		.description('Remove a dependency or a non-blocking link from a task')
		.option('-i, --id <id>', 'Task ID to remove dependency from')
		.option('-d, --depends-on <id>', 'Task ID to remove as a dependency')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			// Initialize TaskGraph
			const taskGraph = initTaskGraph(initOptions);

			const taskId = options.id;
			const dependencyId = options.dependsOn;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			if (!taskId || !dependencyId) {
				console.error(
					chalk.red('Error: Both --id and --depends-on are required')
				);
				process.exit(1);
			}

			// Handle subtask IDs correctly by preserving the string format for IDs containing dots
			// Only use parseInt for simple numeric IDs
			const formattedTaskId = taskId.includes('.')
				? taskId
				: parseInt(taskId, 10);
			const formattedDependencyId = dependencyId.includes('.')
				? dependencyId
				: parseInt(dependencyId, 10);

			await reportDependencyErrors(() =>
				removeDependency(
					taskGraph.getTasksPath(),
					formattedTaskId,
					formattedDependencyId,
					{
						projectRoot: taskGraph.getProjectRoot(),
						tag
					}
				)
			);
		});

	// validate-dependencies command
	programInstance
		.command('validate-dependencies')
		.description(
			`Identify invalid dependencies without fixing them${chalk.reset('')}`
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			// Initialize TaskGraph
			const taskGraph = initTaskGraph(initOptions);

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			const result = await reportDependencyErrors(() =>
				validateDependenciesCommand(taskGraph.getTasksPath(), {
					context: { projectRoot: taskGraph.getProjectRoot(), tag }
				})
			);
			console.log(ui.formatDependencyCheck(result));
			// Which PRD sections have tasks, once parse-prd has recorded sources
			const coverage = ui.formatPrdCoverage(result.prdCoverage);
			if (coverage) console.log(coverage);
			// A check that finds problems fails, so scripts and CI can act on it
			if (!result.valid) process.exitCode = 1;
		});

	// fix-dependencies command
	programInstance
		.command('fix-dependencies')
		.description(`Fix invalid dependencies automatically${chalk.reset('')}`)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			// Initialize TaskGraph
			const taskGraph = initTaskGraph(initOptions);

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			const result = await reportDependencyErrors(() =>
				fixDependenciesCommand(taskGraph.getTasksPath(), {
					context: { projectRoot: taskGraph.getProjectRoot(), tag }
				})
			);
			console.log(ui.formatDependencyFixes(result));
			// Loops between tasks are left for the user; say so in the exit code
			if (result.remaining.length > 0) process.exitCode = 1;
		});

	// complexity-report command
	programInstance
		.command('complexity-report')
		.description(`Display the complexity analysis report${chalk.reset('')}`)
		.option(
			'-f, --file <file>',
			'Path to the report file',
			COMPLEXITY_REPORT_FILE
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			const initOptions = {
				tag: options.tag
			};

			if (options.file && options.file !== COMPLEXITY_REPORT_FILE) {
				initOptions.complexityReportPath = options.file;
			}

			// Initialize TaskGraph
			const taskGraph = initTaskGraph(initOptions);

			// Show current tag context
			await displayCurrentTagIndicator(taskGraph.getCurrentTag(), {
				tasksPath: taskGraph.getTasksPath()
			});

			await displayComplexityReport(taskGraph.getComplexityReportPath());
		});

	// add-subtask command
	programInstance
		.command('add-subtask')
		.description('Add a subtask to an existing task')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-p, --parent <id>', 'Parent task ID (required)')
		.option('-i, --task-id <id>', 'Existing task ID to convert to subtask')
		.option(
			'-t, --title <title>',
			'Title for the new subtask (when creating a new subtask)'
		)
		.option('-d, --description <text>', 'Description for the new subtask')
		.option('--details <text>', 'Implementation details for the new subtask')
		.option(
			'--dependencies <ids>',
			'Comma-separated task or subtask IDs the new subtask depends on (3, 5.2)'
		)
		.option('-s, --status <status>', 'Status for the new subtask', 'pending')
		.option('--generate', 'Regenerate task files after adding subtask')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const parentId = options.parent;
			const existingTaskId = options.taskId;
			const generateFiles = options.generate || false;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			if (!parentId) {
				printError(
					'add-subtask needs --parent, the task to add the subtask to',
					"Try `taskgraph add-subtask --parent=5 --title='<title>'`"
				);
				process.exit(1);
			}
			if (!existingTaskId && !options.title) {
				printError(
					'add-subtask needs --title for a new subtask, or --task-id to move a task',
					`Try \`taskgraph add-subtask --parent=${parentId} --title='<title>'\` or \`--task-id=<id>\``
				);
				process.exit(1);
			}

			// 3 is task 3 and 5.2 is that subtask, as in add-dependency
			let dependencies = [];
			if (options.dependencies) {
				try {
					dependencies = parseSubtaskDependencyInput(options.dependencies);
				} catch (error) {
					displayError(error);
				}
			}

			try {
				if (existingTaskId) {
					const subtask = await addSubtask(
						taskGraph.getTasksPath(),
						parentId,
						existingTaskId,
						null,
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(ui.formatSubtaskAdded(parentId, subtask, existingTaskId));
				} else {
					const subtask = await addSubtask(
						taskGraph.getTasksPath(),
						parentId,
						null,
						{
							title: options.title,
							description: options.description || '',
							details: options.details || '',
							status: options.status || 'pending',
							dependencies
						},
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(ui.formatSubtaskAdded(parentId, subtask));
				}
			} catch (error) {
				displayError(error);
			}
		});

	// remove-subtask command
	programInstance
		.command('remove-subtask')
		.description('Remove a subtask from its parent task')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'-i, --id <id>',
			'Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated for multiple subtasks)'
		)
		.option(
			'-c, --convert',
			'Convert the subtask to a standalone task instead of deleting it'
		)
		.option('--generate', 'Regenerate task files after removing subtask')
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const subtaskIds = options.id;
			const convertToTask = options.convert || false;
			const generateFiles = options.generate || false;
			const tag = taskGraph.getCurrentTag();

			const subtaskIdArray = (subtaskIds ?? '')
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean);
			if (subtaskIdArray.length === 0) {
				printError(
					'remove-subtask needs --id, the subtask to remove',
					'Try `taskgraph remove-subtask --id=5.2`'
				);
				process.exit(1);
			}
			// Check every ID before removing any, so a typo changes nothing
			const notSubtaskId = subtaskIdArray.find((id) => !id.includes('.'));
			if (notSubtaskId) {
				printError(
					`"${notSubtaskId}" isn't a subtask ID`,
					`Subtask IDs look like 5.2; for a task, run \`taskgraph remove-task --id=${notSubtaskId}\``
				);
				process.exit(1);
			}

			try {
				for (const subtaskId of subtaskIdArray) {
					const convertedTask = await removeSubtask(
						taskGraph.getTasksPath(),
						subtaskId,
						convertToTask,
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(ui.formatSubtaskRemoved(subtaskId, convertedTask));
				}
			} catch (error) {
				displayError(error);
			}
		});

	// remove-task command
	programInstance
		.command('remove-task')
		.description('Remove one or more tasks or subtasks permanently')
		.option(
			'-i, --id <ids>',
			'ID(s) of the task(s) or subtask(s) to remove (e.g., "5", "5.2", or "5,6.1,7")'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-y, --yes', 'Skip confirmation prompt', false)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const taskIdsString = options.id;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag, {
				tasksPath: taskGraph.getTasksPath()
			});

			if (!taskIdsString) {
				console.error(chalk.red('Error: Task ID(s) are required'));
				console.error(
					chalk.yellow('Usage: taskgraph remove-task --id=<taskId1,taskId2...>')
				);
				process.exit(1);
			}

			const taskIdsToRemove = taskIdsString
				.split(',')
				.map((id) => id.trim())
				.filter(Boolean);

			if (taskIdsToRemove.length === 0) {
				console.error(chalk.red('Error: No valid task IDs provided.'));
				process.exit(1);
			}

			try {
				// Read data once for checks and confirmation
				const tasksPath = taskGraph.getTasksPath();
				const data = readJSON(tasksPath, taskGraph.getProjectRoot(), tag);
				if (!data || !data.tasks) {
					console.error(
						chalk.red(`Error: No valid tasks found in ${tasksPath}`)
					);
					process.exit(1);
				}

				const existingTasksToRemove = [];
				const nonExistentIds = [];
				let totalSubtasksToDelete = 0;
				const dependentTaskMessages = [];

				for (const taskId of taskIdsToRemove) {
					if (!taskExists(data.tasks, taskId)) {
						nonExistentIds.push(taskId);
					} else {
						// Correctly extract the task object from the result of findTaskById
						const findResult = findTaskById(data.tasks, taskId);
						const taskObject = findResult.task; // Get the actual task/subtask object

						if (taskObject) {
							existingTasksToRemove.push({ id: taskId, task: taskObject }); // Push the actual task object

							// If it's a main task, count its subtasks and check dependents
							if (!taskObject.isSubtask) {
								// Check the actual task object
								if (taskObject.subtasks && taskObject.subtasks.length > 0) {
									totalSubtasksToDelete += taskObject.subtasks.length;
								}
								const dependentTasks = data.tasks.filter(
									(t) =>
										t.dependencies &&
										t.dependencies.some((d) => String(d) === String(taskId))
								);
								if (dependentTasks.length > 0) {
									dependentTaskMessages.push(
										`  - Task ${taskId}: ${dependentTasks.length} dependent tasks (${dependentTasks.map((t) => t.id).join(', ')})`
									);
								}
							}
						} else {
							// Handle case where findTaskById returned null for the task property (should be rare)
							nonExistentIds.push(`${taskId} (error finding details)`);
						}
					}
				}

				const notFoundMessage = `${nonExistentIds.length === 1 ? 'Task' : 'Tasks'} ${nonExistentIds.join(', ')} not found`;

				// Nothing to remove is a failure: the ID was probably mistyped
				if (existingTasksToRemove.length === 0) {
					printError(notFoundMessage, 'Run `taskgraph list` to see task IDs');
					process.exit(1);
				}

				if (nonExistentIds.length > 0) {
					console.warn(chalk.yellow(`${notFoundMessage}, skipping`));
				}

				// Skip confirmation if --yes flag is provided
				if (!options.yes) {
					console.log();
					console.log(
						chalk.red.bold(
							`⚠️ WARNING: This will permanently delete the following ${existingTasksToRemove.length} item(s):`
						)
					);
					console.log();

					existingTasksToRemove.forEach(({ id, task }) => {
						if (!task) return; // Should not happen due to taskExists check, but safeguard
						if (task.isSubtask) {
							// Subtask - title is directly on the task object
							console.log(
								theme.text(`  Subtask ${id}: ${task.title || '(no title)'}`)
							);
							// Optionally show parent context if available
							if (task.parentTask) {
								console.log(
									theme.muted(
										`    (Parent: ${task.parentTask.id} - ${task.parentTask.title || '(no title)'})`
									)
								);
							}
						} else {
							// Main task - title is directly on the task object
							console.log(
								theme.text.bold(`  Task ${id}: ${task.title || '(no title)'}`)
							);
						}
					});

					if (totalSubtasksToDelete > 0) {
						console.log(
							chalk.yellow(
								`⚠️ This will also delete ${totalSubtasksToDelete} subtasks associated with the selected main tasks!`
							)
						);
					}

					if (dependentTaskMessages.length > 0) {
						console.log(
							chalk.yellow(
								'⚠️ Warning: Dependencies on the following tasks will be removed:'
							)
						);
						dependentTaskMessages.forEach((msg) =>
							console.log(chalk.yellow(msg))
						);
					}

					console.log();

					const { confirm } = await inquirer.prompt([
						{
							type: 'confirm',
							name: 'confirm',
							message: chalk.red.bold(
								`Are you sure you want to permanently delete these ${existingTasksToRemove.length} item(s)?`
							),
							default: false
						}
					]);

					if (!confirm) {
						console.log(theme.brand('Task deletion cancelled.'));
						process.exit(0);
					}
				}

				// Use the string of existing IDs for the core function
				const existingIdsString = existingTasksToRemove
					.map(({ id }) => id)
					.join(',');
				const result = await removeTask(
					taskGraph.getTasksPath(),
					existingIdsString,
					{
						projectRoot: taskGraph.getProjectRoot(),
						tag
					}
				);

				if (result.success) {
					console.log(
						ui.formatTasksRemoved(existingTasksToRemove.map(({ id }) => id))
					);
				} else {
					printError(
						`Removed ${result.removedTasks.length} of ${existingTasksToRemove.length}: ${result.error}`,
						'Run `taskgraph list` to see what is left'
					);
					process.exit(1);
				}
			} catch (error) {
				displayError(error);
			}
		});

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
		.option('--aliases', 'Add shell aliases (tm, taskgraph)')
		.option('--no-aliases', 'Skip shell aliases (tm, taskgraph)')
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

	// models command
	programInstance
		.command('models')
		.description('Manage AI model configurations (Claude Code models)')
		.option(
			'--set-main <model_id>',
			'Set the primary model for task generation/updates'
		)
		.option(
			'--set-research <model_id>',
			'Set the model for research-backed operations'
		)
		.option(
			'--set-fallback <model_id>',
			'Set the model to use if the primary fails'
		)
		.option('--setup', 'Run interactive setup to configure models')
		// Accepted for older scripts; Claude Code is the only provider now
		.addOption(new Option('--claude-code').hideHelp())
		// Removed providers: accepted only to explain why they no longer work
		.addOption(new Option('--openrouter').hideHelp())
		.addOption(new Option('--ollama').hideHelp())
		.addOption(new Option('--bedrock').hideHelp())
		.addOption(new Option('--azure').hideHelp())
		.addOption(new Option('--vertex').hideHelp())
		.addOption(new Option('--gemini-cli').hideHelp())
		.addOption(new Option('--codex-cli').hideHelp())
		.addOption(new Option('--lmstudio').hideHelp())
		.addOption(new Option('--openai-compatible').hideHelp())
		.addOption(new Option('--baseURL <url>').hideHelp())
		.addHelpText(
			'after',
			`
TaskGraph uses Claude Code. Available models: opus, sonnet, haiku.

Examples:
  $ taskgraph models                              # View current configuration
  $ taskgraph models --set-main sonnet             # Set main model
  $ taskgraph models --set-research opus           # Set research model
  $ taskgraph models --set-fallback haiku          # Set fallback
  $ taskgraph models --setup                       # Run interactive setup`
		)
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || false
			});

			const projectRoot = taskGraph.getProjectRoot();

			const removedProviderFlags = [
				'openrouter',
				'ollama',
				'bedrock',
				'azure',
				'vertex',
				'geminiCli',
				'codexCli',
				'lmstudio',
				'openaiCompatible',
				'baseURL'
			].filter((flag) => options[flag]);
			if (removedProviderFlags.length > 0) {
				const flag = `--${removedProviderFlags[0] === 'baseURL' ? 'baseURL' : removedProviderFlags[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
				printError(
					`${flag} isn't supported any more; TaskGraph runs on Claude Code`,
					'Choose a model with `taskgraph models --set-main <opus|sonnet|haiku>`'
				);
				process.exit(1);
			}

			if (!isConfigFilePresent(projectRoot)) {
				printError(
					'No .taskgraph/config.json in this project',
					'Run `taskgraph init` to recreate it'
				);
				process.exit(1);
			}

			if (options.setup) {
				try {
					const ok = await runInteractiveSetup(projectRoot);
					if (!ok && !process.exitCode) process.exitCode = 1;
				} catch (setupError) {
					displayError(setupError);
				}
				return;
			}

			const configResult = await getModelConfiguration({ projectRoot });
			if (!configResult.success) {
				printError(
					`Couldn't read the model settings: ${configResult.error.message}`,
					'Run `taskgraph init` to recreate .taskgraph/config.json'
				);
				process.exit(1);
			}
			const active = configResult.data.activeModels;
			const availableResult = await getAvailableModelsList({ projectRoot });
			const availableIds = availableResult.success
				? availableResult.data.models.map((m) => m.modelId)
				: [];

			const requestedChanges = [
				['main', options.setMain],
				['research', options.setResearch],
				['fallback', options.setFallback]
			].filter(([, modelId]) => modelId);

			if (requestedChanges.length > 0) {
				// Check every model first, so a typo in one flag sets nothing
				const unknown = requestedChanges.find(
					([, modelId]) => !availableIds.includes(modelId)
				);
				if (unknown) {
					printError(
						`"${unknown[1]}" isn't a Claude Code model`,
						`Choose ${ui.formatModelChoices(availableIds)}`
					);
					process.exit(1);
				}

				const changes = [];
				for (const [role, modelId] of requestedChanges) {
					const result = await setModel(role, modelId, { projectRoot });
					if (!result.success) {
						if (changes.length > 0) {
							console.log(ui.formatModelChanges(changes));
						}
						printError(
							`Couldn't set the ${role} model: ${result.error.message}`
						);
						process.exit(1);
					}
					changes.push({
						role,
						from: active[role]?.modelId ?? null,
						to: modelId
					});
				}
				console.log(ui.formatModelChanges(changes));
				return;
			}

			console.log(
				ui.formatModelConfiguration(
					{
						main: active.main?.modelId ?? null,
						research: active.research?.modelId ?? null,
						fallback: active.fallback?.modelId ?? null
					},
					availableIds
				)
			);
		});

	// response-language command
	programInstance
		.command('lang')
		.description('Show or set the language AI responses are written in')
		.option('--response <response_language>', 'Set the response language')
		.option('--setup', 'Choose the response language interactively')
		.addHelpText(
			'after',
			`
Examples:
  $ taskgraph lang                       # Show the response language
  $ taskgraph lang --response French     # Set it
  $ taskgraph lang --setup               # Choose it interactively`
		)
		.action(async (options) => {
			const taskGraph = initTaskGraph({});
			const projectRoot = taskGraph.getProjectRoot();
			if (!isConfigFilePresent(projectRoot)) {
				printError(
					'No .taskgraph/config.json in this project',
					'Run `taskgraph init` to recreate it'
				);
				process.exit(1);
			}
			const current = getResponseLanguage(projectRoot) || 'English';
			let language = options.response;

			if (options.setup) {
				try {
					const answer = await inquirer.prompt([
						{
							type: 'input',
							name: 'language',
							message: 'Language for AI responses?',
							default: current
						}
					]);
					language = answer.language;
				} catch (error) {
					if (error?.name !== 'ExitPromptError') throw error;
					console.log(theme.muted('\nCancelled; response language unchanged'));
					process.exitCode = 130;
					return;
				}
			}

			// Without --response or --setup, show the setting instead of
			// resetting it to English
			if (language === undefined) {
				console.log(`Response language: ${theme.brand(current)}`);
				console.log(
					theme.muted('Change it with ') +
						theme.brand('taskgraph lang --response <language>')
				);
				return;
			}

			language = language.trim();
			const result = setResponseLanguage(language, { projectRoot });
			if (!result.success) {
				printError(
					`Couldn't set the response language: ${result.error.message}`
				);
				process.exit(1);
			}
			const change =
				language === current
					? `${theme.brand(language)} ${theme.muted('(unchanged)')}`
					: `${current} → ${theme.brand(language)}`;
			console.log(`${chalk.green('✓')} Response language  ${change}`);
		});

	// move-task command
	programInstance
		.command('move')
		.description(
			'Move tasks between tags or reorder within tags. Supports cross-tag moves with dependency resolution options.'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'--from <id>',
			'ID of the task/subtask to move (e.g., "5" or "5.2"). Can be comma-separated to move multiple tasks (e.g., "5,6,7")'
		)
		.option(
			'--to <id>',
			'ID of the destination (e.g., "7" or "7.3"). Must match the number of source IDs if comma-separated'
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.option('--from-tag <tag>', 'Source tag for cross-tag moves')
		.option('--to-tag <tag>', 'Target tag for cross-tag moves')
		.option('--with-dependencies', 'Move dependent tasks along with main task')
		.option('--ignore-dependencies', 'Break cross-tag dependencies during move')
		.action(async (options) => {
			// Helper function to show move command help - defined in scope for proper encapsulation
			function showMoveHelp() {
				console.log(
					theme.text.bold('Move Command Help') +
						'\n\n' +
						chalk.cyan('Move tasks between tags or reorder within tags.') +
						'\n\n' +
						chalk.yellow.bold('Within-Tag Moves:') +
						'\n' +
						theme.text('  taskgraph move --from=5 --to=7') +
						'\n' +
						theme.text('  taskgraph move --from=5.2 --to=7.3') +
						'\n' +
						theme.text('  taskgraph move --from=5,6,7 --to=10,11,12') +
						'\n\n' +
						chalk.yellow.bold('Cross-Tag Moves:') +
						'\n' +
						theme.text(
							'  taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress'
						) +
						'\n' +
						theme.text(
							'  taskgraph move --from=5,6 --from-tag=backlog --to-tag=done'
						) +
						'\n\n' +
						chalk.yellow.bold('Dependency Resolution:') +
						'\n' +
						theme.text('  # Move with dependencies') +
						'\n' +
						theme.text(
							'  taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress --with-dependencies'
						) +
						'\n\n' +
						theme.text('  # Break dependencies') +
						'\n' +
						theme.text(
							'  taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress --ignore-dependencies'
						) +
						'\n\n' +
						'\n' +
						chalk.yellow.bold('Best Practices:') +
						'\n' +
						theme.text(
							'  • Use --with-dependencies to move dependent tasks together'
						) +
						'\n' +
						theme.text(
							'  • Use --ignore-dependencies to break cross-tag dependencies'
						) +
						'\n' +
						theme.text(
							'  • Check dependencies first: taskgraph validate-dependencies'
						) +
						'\n' +
						theme.text(
							'  • Fix dependency issues: taskgraph fix-dependencies'
						) +
						'\n\n' +
						chalk.yellow.bold('Error Resolution:') +
						'\n' +
						theme.text(
							'  • Cross-tag dependency conflicts: Use --with-dependencies or --ignore-dependencies'
						) +
						'\n' +
						theme.text(
							'  • Subtask movement: Promote subtask first with remove-subtask --convert'
						) +
						'\n' +
						theme.text(
							'  • Invalid tags: Check available tags with taskgraph tags'
						) +
						'\n\n' +
						theme.muted('For more help, run: taskgraph move --help')
				);
			}

			// Helper function to handle cross-tag move logic
			async function handleCrossTagMove(moveContext, options) {
				const { sourceId, sourceTag, toTag, taskGraph } = moveContext;

				if (!sourceId) {
					console.error(
						chalk.red('Error: --from parameter is required for cross-tag moves')
					);
					showMoveHelp();
					process.exit(1);
				}

				const sourceIds = sourceId.split(',').map((id) => id.trim());
				const moveOptions = {
					withDependencies: options.withDependencies || false,
					ignoreDependencies: options.ignoreDependencies || false
				};

				console.log(
					theme.brand(
						`Moving tasks ${sourceIds.join(', ')} from "${sourceTag}" to "${toTag}"...`
					)
				);

				const result = await moveTasksBetweenTags(
					taskGraph.getTasksPath(),
					sourceIds,
					sourceTag,
					toTag,
					moveOptions,
					{ projectRoot: taskGraph.getProjectRoot() }
				);

				console.log(chalk.green(`✓ ${result.message}`));

				// Print any tips returned from the move operation (e.g., after ignoring dependencies)
				if (Array.isArray(result.tips) && result.tips.length > 0) {
					console.log('\n' + chalk.yellow.bold('Next Steps:'));
					result.tips.forEach((t) => console.log(theme.text(`  • ${t}`)));
				}
			}

			// Helper function to handle within-tag move logic
			async function handleWithinTagMove(moveContext) {
				const { sourceId, destinationId, tag, taskGraph } = moveContext;

				if (!sourceId || !destinationId) {
					console.error(
						chalk.red(
							'Error: Both --from and --to parameters are required for within-tag moves'
						)
					);
					console.log(
						chalk.yellow(
							'Usage: taskgraph move --from=<sourceId> --to=<destinationId>'
						)
					);
					process.exit(1);
				}

				// Check if we're moving multiple tasks (comma-separated IDs)
				const sourceIds = sourceId.split(',').map((id) => id.trim());
				const destinationIds = destinationId.split(',').map((id) => id.trim());

				// Validate that the number of source and destination IDs match
				if (sourceIds.length !== destinationIds.length) {
					console.error(
						chalk.red(
							'Error: The number of source and destination IDs must match'
						)
					);
					console.log(
						chalk.yellow('Example: taskgraph move --from=5,6,7 --to=10,11,12')
					);
					process.exit(1);
				}

				// If moving multiple tasks
				if (sourceIds.length > 1) {
					console.log(
						theme.brand(
							`Moving multiple tasks: ${sourceIds.join(', ')} to ${destinationIds.join(', ')}...`
						)
					);

					// Read tasks data once to validate destination IDs
					const tasksData = readJSON(
						taskGraph.getTasksPath(),
						taskGraph.getProjectRoot(),
						tag
					);
					if (!tasksData || !tasksData.tasks) {
						console.error(
							chalk.red(
								`Error: Invalid or missing tasks file at ${taskGraph.getTasksPath()}`
							)
						);
						process.exit(1);
					}

					// Collect errors during move attempts
					const moveErrors = [];
					const successfulMoves = [];

					// Move tasks one by one
					for (let i = 0; i < sourceIds.length; i++) {
						const fromId = sourceIds[i];
						const toId = destinationIds[i];

						// Skip if source and destination are the same
						if (fromId === toId) {
							console.log(
								chalk.yellow(`Skipping ${fromId} -> ${toId} (same ID)`)
							);
							continue;
						}

						try {
							await moveTask(
								taskGraph.getTasksPath(),
								fromId,
								toId,
								i === sourceIds.length - 1,
								{ projectRoot: taskGraph.getProjectRoot(), tag }
							);
							console.log(
								chalk.green(
									`✓ Successfully moved task/subtask ${fromId} to ${toId}`
								)
							);
							successfulMoves.push({ fromId, toId });
						} catch (error) {
							const errorInfo = {
								fromId,
								toId,
								error: error.message
							};
							moveErrors.push(errorInfo);
							console.error(
								chalk.red(`Error moving ${fromId} to ${toId}: ${error.message}`)
							);
							// Continue with the next task rather than exiting
						}
					}

					// Display summary after all moves are attempted
					if (moveErrors.length > 0) {
						console.log(chalk.yellow('\n--- Move Operation Summary ---'));
						console.log(
							chalk.green(
								`✓ Successfully moved: ${successfulMoves.length} tasks`
							)
						);
						console.log(
							chalk.red(`✗ Failed to move: ${moveErrors.length} tasks`)
						);

						if (successfulMoves.length > 0) {
							console.log(chalk.cyan('\nSuccessful moves:'));
							successfulMoves.forEach(({ fromId, toId }) => {
								console.log(chalk.cyan(`  ${fromId} → ${toId}`));
							});
						}

						console.log(chalk.red('\nFailed moves:'));
						moveErrors.forEach(({ fromId, toId, error }) => {
							console.log(chalk.red(`  ${fromId} → ${toId}: ${error}`));
						});

						console.log(
							chalk.yellow(
								'\nNote: Some tasks were moved successfully. Check the errors above for failed moves.'
							)
						);
					} else {
						console.log(chalk.green('\n✓ All tasks moved successfully!'));
					}
				} else {
					// Moving a single task (existing logic)

					const result = await moveTask(
						taskGraph.getTasksPath(),
						sourceId,
						destinationId,
						true,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(
						chalk.green(
							`✓ Successfully moved task/subtask ${sourceId} to ${destinationId}`
						)
					);
				}
			}

			// Helper function to handle move errors
			function handleMoveError(error, moveContext) {
				const structured = [
					'CROSS_TAG_DEPENDENCY_CONFLICTS',
					'CANNOT_MOVE_SUBTASK',
					'SOURCE_TARGET_TAGS_SAME',
					'SAME_SOURCE_TARGET_TAG'
				];
				// Anything else (a missing ID, a taken destination) is one line
				// and a hint; the dependency tips only help the cases below
				if (!structured.includes(error.code)) {
					displayError(error, {
						hint: /already exists/i.test(error.message)
							? 'Run `taskgraph list` to see which IDs are taken'
							: undefined
					});
				}

				console.error(chalk.red(`Error: ${error.message}`));

				// Enhanced error handling with structured error objects
				if (error.code === 'CROSS_TAG_DEPENDENCY_CONFLICTS') {
					// Use structured error data
					const conflicts = error.data.conflicts || [];
					const taskIds = error.data.taskIds || [];
					displayCrossTagDependencyError(
						conflicts,
						moveContext.sourceTag,
						moveContext.toTag,
						taskIds.join(', ')
					);
				} else if (error.code === 'CANNOT_MOVE_SUBTASK') {
					// Use structured error data
					const taskId =
						error.data.taskId || moveContext.sourceId?.split(',')[0];
					displaySubtaskMoveError(
						taskId,
						moveContext.sourceTag,
						moveContext.toTag
					);
				} else if (
					error.code === 'SOURCE_TARGET_TAGS_SAME' ||
					error.code === 'SAME_SOURCE_TARGET_TAG'
				) {
					displayInvalidTagCombinationError(
						moveContext.sourceTag,
						moveContext.toTag,
						'Source and target tags are identical'
					);
				} else {
					// General error - show dependency validation hints
					displayDependencyValidationHints('after-error');
				}

				process.exit(1);
			}

			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const sourceId = options.from;
			const destinationId = options.to;
			const fromTag = options.fromTag;
			const toTag = options.toTag;

			const tag = taskGraph.getCurrentTag();

			// Get the source tag - fallback to current tag if not provided
			const sourceTag = fromTag || taskGraph.getCurrentTag();

			// Check if this is a cross-tag move (different tags)
			const isCrossTagMove = sourceTag && toTag && sourceTag !== toTag;

			// Initialize move context with all relevant data
			const moveContext = {
				sourceId,
				destinationId,
				sourceTag,
				toTag,
				tag,
				taskGraph
			};

			try {
				if (isCrossTagMove) {
					// Cross-tag move logic
					await handleCrossTagMove(moveContext, options);
				} else {
					// Within-tag move logic
					await handleWithinTagMove(moveContext);
				}
			} catch (error) {
				const errMsg = String(error && (error.message || error));
				if (errMsg.includes('already exists in target tag')) {
					console.error(chalk.red(`Error: ${errMsg}`));
					console.log(
						'\n' +
							chalk.yellow.bold('Conflict: ID already exists in target tag') +
							'\n' +
							theme.text(
								'  • Choose a different target tag without conflicting IDs'
							) +
							'\n' +
							theme.text(
								'  • Move a different set of IDs (avoid existing ones)'
							) +
							'\n' +
							theme.text(
								'  • If needed, move within-tag to a new ID first, then cross-tag move'
							)
					);
					process.exit(1);
				}
				handleMoveError(error, moveContext);
			}
		});

	// sync-readme command
	programInstance
		.command('sync-readme')
		.description('Sync the current task list to README.md in the project root')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('--with-subtasks', 'Include subtasks in the README output')
		.option(
			'-s, --status <status>',
			'Show only tasks matching this status (e.g., pending, done)'
		)
		.option('-t, --tag <tag>', 'Tag to use for the task list (default: master)')
		.action(async (options) => {
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const withSubtasks = options.withSubtasks || false;
			const status = options.status || null;

			const tag = taskGraph.getCurrentTag();

			console.log(
				theme.brand(
					`📝 Syncing tasks to README.md${withSubtasks ? ' (with subtasks)' : ''}${status ? ` (status: ${status})` : ''}...`
				)
			);

			const success = await syncTasksToReadme(taskGraph.getProjectRoot(), {
				withSubtasks,
				status,
				tasksPath: taskGraph.getTasksPath(),
				tag
			});

			if (!success) {
				console.error(chalk.red('❌ Failed to sync tasks to README.md'));
				process.exit(1);
			}
		});

	// ===== TAG MANAGEMENT COMMANDS =====

	/** One line on stderr pointing at the command that replaces an alias */
	function warnDeprecated(alias, replacement) {
		console.error(
			`${chalk.yellow('⚠')} ${alias} is deprecated; use ${theme.brand(`taskgraph ${replacement}`)}`
		);
	}

	// add-tag command (DEPRECATED - use `tm tags add` instead)
	programInstance
		.command('add-tag')
		.description(
			'[DEPRECATED] Create a new tag context for organizing tasks (use "taskgraph tags add" instead)'
		)
		.argument(
			'[tagName]',
			'Name of the new tag to create (optional when using --from-branch)'
		)
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option(
			'--copy-from-current',
			'Copy tasks from the current tag to the new tag'
		)
		.option(
			'--copy-from <tag>',
			'Copy tasks from the specified tag to the new tag'
		)
		.option(
			'--from-branch',
			'Create tag name from current git branch (ignores tagName argument)'
		)
		.option('-d, --description <text>', 'Optional description for the tag')
		.action(async (tagName, options) => {
			warnDeprecated('add-tag', 'tags add');

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					printError('No tasks yet', NO_TASKS_FILE_HINT);
					process.exit(1);
				}

				// Validate that either tagName is provided or --from-branch is used
				if (!tagName && !options.fromBranch) {
					printError(
						'add-tag needs a tag name',
						'Example: `taskgraph tags add feature-auth`, or `--from-branch`'
					);
					process.exit(1);
				}

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'add-tag',
					outputType: 'cli'
				};

				const createOptions = {
					copyFromCurrent: options.copyFromCurrent || false,
					copyFromTag: options.copyFrom,
					description: options.description
				};

				if (options.fromBranch) {
					// Names the tag after the current git branch and maps the branch to it
					await createTagFromBranch(
						context.projectRoot,
						(branchTag, { defaultDescription }) =>
							createTag(
								tasksPath,
								branchTag,
								{ ...createOptions, defaultDescription },
								context,
								'text'
							)
					).catch((error) => {
						throw fromBranchError(error);
					});
				} else {
					await createTag(tasksPath, tagName, createOptions, context, 'text');
				}
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			displayError(err);
		});

	// delete-tag command (DEPRECATED - use `tm tags remove` instead)
	programInstance
		.command('delete-tag')
		.description(
			'[DEPRECATED] Delete an existing tag and all its tasks (use "taskgraph tags remove" instead)'
		)
		.argument('<tagName>', 'Name of the tag to delete')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-y, --yes', 'Skip confirmation prompts')
		.action(async (tagName, options) => {
			warnDeprecated('delete-tag', 'tags remove');

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					printError('No tasks yet', NO_TASKS_FILE_HINT);
					process.exit(1);
				}

				const deleteOptions = {
					yes: options.yes || false
				};

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'delete-tag',
					outputType: 'cli'
				};

				await deleteTag(
					taskGraph.getTasksPath(),
					tagName,
					deleteOptions,
					context,
					'text'
				);
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			displayError(err);
		});

	// tags command - REMOVED
	// This command has been replaced by the new CommandRegistry-based TagsCommand
	// in apps/cli/src/commands/tags.command.ts
	// The old implementation is no longer needed

	// use-tag command (DEPRECATED - use `tm tags use` instead)
	programInstance
		.command('use-tag')
		.description(
			'[DEPRECATED] Switch to a different tag context (use "taskgraph tags use" instead)'
		)
		.argument('<tagName>', 'Name of the tag to switch to')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.action(async (tagName, options) => {
			warnDeprecated('use-tag', 'tags use');

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					printError('No tasks yet', NO_TASKS_FILE_HINT);
					process.exit(1);
				}

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'use-tag',
					outputType: 'cli'
				};

				await useTag(taskGraph.getTasksPath(), tagName, {}, context, 'text');
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			displayError(err);
		});

	// rename-tag command (DEPRECATED - use `tm tags rename` instead)
	programInstance
		.command('rename-tag')
		.description(
			'[DEPRECATED] Rename an existing tag (use "taskgraph tags rename" instead)'
		)
		.argument('<oldName>', 'Current name of the tag')
		.argument('<newName>', 'New name for the tag')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.action(async (oldName, newName, options) => {
			warnDeprecated('rename-tag', 'tags rename');

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					printError('No tasks yet', NO_TASKS_FILE_HINT);
					process.exit(1);
				}

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'rename-tag',
					outputType: 'cli'
				};

				await renameTag(
					taskGraph.getTasksPath(),
					oldName,
					newName,
					{},
					context,
					'text'
				);
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			displayError(err);
		});

	// copy-tag command (DEPRECATED - use `tm tags copy` instead)
	programInstance
		.command('copy-tag')
		.description(
			'[DEPRECATED] Copy an existing tag to create a new tag with the same tasks (use "taskgraph tags copy" instead)'
		)
		.argument('<sourceName>', 'Name of the source tag to copy from')
		.argument('<targetName>', 'Name of the new tag to create')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-d, --description <text>', 'Optional description for the new tag')
		.action(async (sourceName, targetName, options) => {
			warnDeprecated('copy-tag', 'tags copy');

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					printError('No tasks yet', NO_TASKS_FILE_HINT);
					process.exit(1);
				}

				const copyOptions = {
					description: options.description
				};

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'copy-tag',
					outputType: 'cli'
				};

				await copyTag(
					tasksPath,
					sourceName,
					targetName,
					copyOptions,
					context,
					'text'
				);
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			displayError(err);
		});

	// tui / repl command - launches the interactive TUI
	programInstance
		.command('tui')
		.alias('repl')
		.description('Launch the interactive TUI/REPL mode')
		.action(async () => {
			await launchREPL();
		});

	return programInstance;
}

/**
 * Launch the interactive TUI REPL. The TUI is not built yet, so this shows
 * help instead.
 */
async function launchREPL() {
	console.log(chalk.yellow('TUI mode coming soon!'));
	console.log(chalk.dim('Showing help instead...\n'));
	displayHelp();
}

// Commands that work outside a project
const NO_TASKS_FILE_HINT = 'Create some with `taskgraph parse-prd <file>`';

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
	'tui',
	'repl'
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
				write(`\n${formatCommanderError(text, path || undefined)}\n`)
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
		// Bare `taskgraph` gets the banner like `--help`: until the TUI ships,
		// launchREPL falls back to the help screen (a real TUI clears the screen
		// and draws its own)
		if (argv.length <= 2) {
			if (
				ui.shouldShowAsciiBanner(argv.slice(2), Boolean(process.stdout.isTTY))
			) {
				displayBanner();
			}
			await launchREPL();
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

/**
 * Resolve the final complexity-report path.
 * Rules:
 *  1. If caller passes --output, always respect it.
 *  2. If no explicit output AND tag === 'master' → default report file
 *  3. If no explicit output AND tag !== 'master' → append _<tag>.json
 *
 * @param {string|undefined} outputOpt  --output value from CLI (may be undefined)
 * @param {string} targetTag            resolved tag (defaults to 'master')
 * @param {string} projectRoot          absolute project root
 * @returns {string} absolute path for the report
 */
export function resolveComplexityReportPath({
	projectRoot,
	tag = 'master',
	output // may be undefined
}) {
	// 1. user knows best
	if (output) {
		return path.isAbsolute(output) ? output : path.join(projectRoot, output);
	}

	// 2. default naming
	const base = path.join(projectRoot, COMPLEXITY_REPORT_FILE);
	return tag !== 'master' ? base.replace('.json', `_${tag}.json`) : base;
}

export { registerCommands, setupCLI, runCLI, launchREPL };
