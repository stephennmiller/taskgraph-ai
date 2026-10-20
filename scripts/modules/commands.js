/**
 * commands.js
 * Command-line interface for the TaskGraph CLI
 */

import fs from 'fs';
import path from 'path';
import boxen from 'boxen';
import chalk from 'chalk';
import { Command, Option } from 'commander';
import inquirer from 'inquirer';

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
	runInteractiveSetup
} from '@tm/cli';
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
	fixDependenciesCommand,
	removeDependency,
	validateDependenciesCommand
} from './dependency-manager.js';

import {
	ConfigurationError,
	getConfig,
	getDefaultNumTasks,
	isConfigFilePresent
} from './config-manager.js';

import { CUSTOM_PROVIDERS } from '@tm/core';

import {
	COMPLEXITY_REPORT_FILE,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../../src/constants/paths.js';

import { initTaskGraph } from '../../src/taskgraph.js';

import {
	confirmTaskOverwrite,
	displayAvailableModels,
	displayBanner,
	displayComplexityReport,
	displayCrossTagDependencyError,
	displayCurrentTagIndicator,
	displayDependencyValidationHints,
	displayHelp,
	displayInvalidTagCombinationError,
	displayModelConfiguration,
	displaySubtaskMoveError,
	displayTaggedTasksFYI,
	getStatusWithColor,
	startLoadingIndicator,
	stopLoadingIndicator
} from './ui.js';

import { BORDER_COLOR, theme } from '@tm/cli/theme';
import {
	RULE_PROFILES,
	findInvalidRulesProfiles
} from '../../src/constants/profiles.js';
import { getTaskGraphVersion } from '../../src/utils/getVersion.js';
import { initializeProject } from '../init.js';

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
			'Number of tasks to generate',
			getDefaultNumTasks()
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

			const numTasks = parseInt(options.numTasks, 10);
			const force = options.force || false;
			const append = options.append || false;
			const research = options.research || false;
			let useForce = force;
			const useAppend = append;

			// Resolve tag using standard pattern
			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag);

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
						if (
							allData[tag] &&
							Array.isArray(allData[tag].tasks) &&
							allData[tag].tasks.length > 0
						) {
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
						log('info', 'Operation cancelled.');
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

				// The progress display names the file and task count, so no preamble
				if (append) {
					console.log(theme.brand('Appending to existing tasks...'));
				}
				if (research) {
					console.log(
						theme.brand(
							'Using Claude Code web research for research-backed task generation'
						)
					);
				}

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
			await displayCurrentTagIndicator(tag);

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

			console.log(
				theme.brand(
					`Updating tasks from ID >= ${fromId} with prompt: "${prompt}"`
				)
			);

			console.log(theme.brand(`Tasks file: ${tasksPath}`));

			if (useResearch) {
				console.log(
					theme.brand(
						'Using Claude Code web research for research-backed task updates'
					)
				);
			}

			// Call core updateTasks, passing context for CLI
			await updateTasks(
				taskGraph.getTasksPath(),
				fromId,
				prompt,
				useResearch,
				{ projectRoot: taskGraph.getProjectRoot(), tag } // Pass context with projectRoot and tag
			);
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
				await displayCurrentTagIndicator(tag);

				// Prioritize positional arguments over options
				const taskId = idArg || options.id;
				const prompt =
					promptWords.length > 0 ? promptWords.join(' ') : options.prompt;

				// Validate required parameters
				if (!taskId) {
					console.error(chalk.red('Error: Task ID is required'));
					console.log(
						chalk.yellow(
							'Usage examples:\n' +
								'  tm update-task 1 Added implementation details\n' +
								'  tm update-task TAS-123 Fixed the auth bug\n' +
								'  tm update-task --id=23 --prompt="Update with new information"'
						)
					);
					process.exit(1);
				}

				// Validate the task ID is a positive integer (e.g. 1,2,3)
				// Disallow decimals and invalid formats
				const validId = /^\d+$/.test(taskId);

				if (!validId) {
					console.error(
						chalk.red(
							`Error: Invalid task ID: ${taskId}. Task ID must be a positive integer.`
						)
					);
					console.log(
						chalk.yellow(
							'Usage examples:\n' +
								'  tm update-task 1 Added implementation details\n' +
								'  tm update-task 7 Fixed the auth bug'
						)
					);
					process.exit(1);
				}

				if (!prompt) {
					console.error(
						chalk.red(
							'Error: Prompt is required. Please provide information about the changes.'
						)
					);
					console.log(
						chalk.yellow(
							'Usage examples:\n' +
								'  tm update-task 1 Added implementation details\n' +
								'  tm update-task 23 "Update with new information"'
						)
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

				console.log(
					theme.brand(`Updating task ${taskId} with prompt: "${prompt}"`)
				);

				console.log(theme.brand(`Tasks file: ${tasksPath}`));

				if (useResearch) {
					console.log(
						theme.brand('Using Claude Code web research for this update')
					);
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

				// If the task wasn't updated (e.g., if it was already marked as done)
				if (!result) {
					console.log(
						chalk.yellow(
							'\nTask update was not completed. Review the messages above for details.'
						)
					);
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
				await displayCurrentTagIndicator(tag);

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

				console.log(
					theme.brand(`Updating subtask ${subtaskId} with prompt: "${prompt}"`)
				);

				console.log(theme.brand(`Tasks file: ${tasksPath}`));

				if (useResearch) {
					console.log(
						theme.brand('Using Claude Code web research for this update')
					);
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
				await displayCurrentTagIndicator(tag);

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
						`Scoping up ${taskIds.length} task(s): ${taskIds.join(', ')}`
					)
				);
				console.log(theme.brand(`Strength level: ${options.strength}`));
				if (options.prompt) {
					console.log(theme.brand(`Custom instructions: ${options.prompt}`));
				}

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
						`✅ Successfully scoped up ${result.updatedTasks.length} task(s)`
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
				await displayCurrentTagIndicator(tag);

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
						`Scoping down ${taskIds.length} task(s): ${taskIds.join(', ')}`
					)
				);
				console.log(theme.brand(`Strength level: ${options.strength}`));
				if (options.prompt) {
					console.log(theme.brand(`Custom instructions: ${options.prompt}`));
				}

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
						`✅ Successfully scoped down ${result.updatedTasks.length} task(s)`
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
			'-cr, --complexity-report <file>',
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
			await displayCurrentTagIndicator(tag);

			if (options.all) {
				// --- Handle expand --all ---
				console.log(theme.brand('Expanding all pending tasks...'));
				// Updated call to the refactored expandAllTasks
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

				console.log(theme.brand(`Expanding task ${options.id}...`));
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

			const modelOverride = options.model;
			const thresholdScore = parseFloat(options.threshold);
			const useResearch = options.research || false;

			// Use the provided tag, or the current active tag, or default to 'master'
			const targetTag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(targetTag);

			// Use user's explicit output path if provided, otherwise use tag-aware default
			const outputPath = taskGraph.getComplexityReportPath();

			console.log(
				theme.brand(
					`Analyzing task complexity from: ${taskGraph.getTasksPath()}`
				)
			);
			console.log(theme.brand(`Output report will be saved to: ${outputPath}`));

			if (options.id) {
				console.log(theme.brand(`Analyzing specific task IDs: ${options.id}`));
			} else if (options.from || options.to) {
				const fromStr = options.from ? options.from : 'first';
				const toStr = options.to ? options.to : 'last';
				console.log(
					theme.brand(`Analyzing tasks in range: ${fromStr} to ${toStr}`)
				);
			}

			if (useResearch) {
				console.log(
					theme.brand(
						'Using Claude Code web research for research-backed complexity analysis'
					)
				);
			}

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
		.option(
			'-s, --save <file>',
			'Save research results to the specified task/subtask(s)'
		)
		.option(
			'-d, --detail <level>',
			'Output detail level: low, medium, high',
			'medium'
		)
		.option(
			'--save-to <id>',
			'Automatically save research results to specified task/subtask ID (e.g., "15" or "15.2")'
		)
		.option(
			'--save-file',
			'Save research results to .taskgraph/docs/research/ directory'
		)
		.option('--tag <tag>', 'Specify tag context for task operations')
		.action(async (prompt, options) => {
			// Initialize TaskGraph
			const initOptions = {
				tasksPath: options.file || true,
				tag: options.tag
			};

			const taskGraph = initTaskGraph(initOptions);

			// Parameter validation
			if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
				console.error(
					chalk.red('Error: Research prompt is required and cannot be empty')
				);
				showResearchHelp();
				process.exit(1);
			}

			// Validate detail level
			const validDetailLevels = ['low', 'medium', 'high'];
			if (
				options.detail &&
				!validDetailLevels.includes(options.detail.toLowerCase())
			) {
				console.error(
					chalk.red(
						`Error: Detail level must be one of: ${validDetailLevels.join(', ')}`
					)
				);
				process.exit(1);
			}

			// Validate and parse task IDs if provided
			let taskIds = [];
			if (options.id) {
				try {
					taskIds = options.id.split(',').map((id) => {
						const trimmedId = id.trim();
						// Support both task IDs (e.g., "15") and subtask IDs (e.g., "15.2")
						if (!/^\d+(\.\d+)?$/.test(trimmedId)) {
							throw new Error(
								`Invalid task ID format: "${trimmedId}". Expected format: "15" or "15.2"`
							);
						}
						return trimmedId;
					});
				} catch (error) {
					console.error(chalk.red(`Error parsing task IDs: ${error.message}`));
					process.exit(1);
				}
			}

			// Validate and parse file paths if provided
			let filePaths = [];
			if (options.files) {
				try {
					filePaths = options.files.split(',').map((filePath) => {
						const trimmedPath = filePath.trim();
						if (trimmedPath.length === 0) {
							throw new Error('Empty file path provided');
						}
						return trimmedPath;
					});
				} catch (error) {
					console.error(
						chalk.red(`Error parsing file paths: ${error.message}`)
					);
					process.exit(1);
				}
			}

			// Validate save-to option if provided
			if (options.saveTo) {
				const saveToId = options.saveTo.trim();
				if (saveToId.length === 0) {
					console.error(chalk.red('Error: Save-to ID cannot be empty'));
					process.exit(1);
				}
				// Validate ID format: number or number.number
				if (!/^\d+(\.\d+)?$/.test(saveToId)) {
					console.error(
						chalk.red(
							'Error: Save-to ID must be in format "15" for task or "15.2" for subtask'
						)
					);
					process.exit(1);
				}
			}

			// Validate save option if provided (legacy file save)
			if (options.save) {
				const saveTarget = options.save.trim();
				if (saveTarget.length === 0) {
					console.error(chalk.red('Error: Save target cannot be empty'));
					process.exit(1);
				}
				// Check if it's a valid file path (basic validation)
				if (saveTarget.includes('..') || saveTarget.startsWith('/')) {
					console.error(
						chalk.red(
							'Error: Save path must be relative and cannot contain ".."'
						)
					);
					process.exit(1);
				}
			}

			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag);

			// Validate tasks file exists if task IDs are specified
			if (taskIds.length > 0) {
				try {
					const tasksData = readJSON(
						taskGraph.getTasksPath(),
						taskGraph.getProjectRoot(),
						tag
					);
					if (!tasksData || !tasksData.tasks) {
						console.error(
							chalk.red(
								`Error: No valid tasks found in ${taskGraph.getTasksPath()} for tag '${tag}'`
							)
						);
						process.exit(1);
					}
				} catch (error) {
					console.error(
						chalk.red(`Error reading tasks file: ${error.message}`)
					);
					process.exit(1);
				}
			}

			// Validate file paths exist if specified
			if (filePaths.length > 0) {
				for (const filePath of filePaths) {
					const fullPath = path.isAbsolute(filePath)
						? filePath
						: path.join(taskGraph.getProjectRoot(), filePath);
					if (!fs.existsSync(fullPath)) {
						console.error(chalk.red(`Error: File not found: ${filePath}`));
						process.exit(1);
					}
				}
			}

			// Create validated parameters object
			const validatedParams = {
				prompt: prompt.trim(),
				taskIds: taskIds,
				filePaths: filePaths,
				customContext: options.context ? options.context.trim() : null,
				includeProjectTree: !!options.tree,
				saveTarget: options.save ? options.save.trim() : null,
				saveToId: options.saveTo ? options.saveTo.trim() : null,
				allowFollowUp: true, // Always allow follow-up in CLI
				detailLevel: options.detail ? options.detail.toLowerCase() : 'medium',
				tasksPath: taskGraph.getTasksPath(),
				projectRoot: taskGraph.getProjectRoot()
			};

			// Display what we're about to do
			console.log(theme.brand(`Researching: "${validatedParams.prompt}"`));

			if (validatedParams.taskIds.length > 0) {
				console.log(
					theme.muted(`Task context: ${validatedParams.taskIds.join(', ')}`)
				);
			}

			if (validatedParams.filePaths.length > 0) {
				console.log(
					theme.muted(`File context: ${validatedParams.filePaths.join(', ')}`)
				);
			}

			if (validatedParams.customContext) {
				console.log(
					theme.muted(
						`Custom context: ${validatedParams.customContext.substring(0, 50)}${validatedParams.customContext.length > 50 ? '...' : ''}`
					)
				);
			}

			if (validatedParams.includeProjectTree) {
				console.log(theme.muted('Including project file tree'));
			}

			console.log(theme.muted(`Detail level: ${validatedParams.detailLevel}`));

			try {
				// Import the research function
				const { performResearch } = await import('./task-manager/research.js');

				// Prepare research options
				const researchOptions = {
					taskIds: validatedParams.taskIds,
					filePaths: validatedParams.filePaths,
					customContext: validatedParams.customContext || '',
					includeProjectTree: validatedParams.includeProjectTree,
					detailLevel: validatedParams.detailLevel,
					projectRoot: validatedParams.projectRoot,
					saveToFile: !!options.saveFile,
					tag: tag
				};

				// Execute research
				const result = await performResearch(
					validatedParams.prompt,
					researchOptions,
					{
						commandName: 'research',
						outputType: 'cli',
						tag: tag
					},
					'text',
					validatedParams.allowFollowUp // Pass follow-up flag
				);

				// Auto-save to task/subtask if requested and no interactive save occurred
				if (validatedParams.saveToId && !result.interactiveSaveOccurred) {
					try {
						const isSubtask = validatedParams.saveToId.includes('.');

						// Format research content for saving
						const researchContent = `## Research Query: ${validatedParams.prompt}

**Detail Level:** ${result.detailLevel}
**Context Size:** ${result.contextSize} characters
**Timestamp:** ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}

### Results

${result.result}`;

						if (isSubtask) {
							// Save to subtask
							const { updateSubtaskById } = await import(
								'./task-manager/update-subtask-by-id.js'
							);

							await updateSubtaskById(
								validatedParams.tasksPath,
								validatedParams.saveToId,
								researchContent,
								false, // useResearch = false for simple append
								{
									commandName: 'research-save',
									outputType: 'cli',
									projectRoot: validatedParams.projectRoot,
									tag: tag
								},
								'text'
							);

							console.log(
								chalk.green(
									`✅ Research saved to subtask ${validatedParams.saveToId}`
								)
							);
						} else {
							// Save to task
							const updateTaskById = (
								await import('./task-manager/update-task-by-id.js')
							).default;

							const taskIdNum = parseInt(validatedParams.saveToId, 10);
							await updateTaskById(
								validatedParams.tasksPath,
								taskIdNum,
								researchContent,
								false, // useResearch = false for simple append
								{
									commandName: 'research-save',
									outputType: 'cli',
									projectRoot: validatedParams.projectRoot,
									tag: tag
								},
								'text',
								true // appendMode = true
							);

							console.log(
								chalk.green(
									`✅ Research saved to task ${validatedParams.saveToId}`
								)
							);
						}
					} catch (saveError) {
						console.log(
							chalk.red(`❌ Error saving to task/subtask: ${saveError.message}`)
						);
					}
				}

				// Save results to file if requested (legacy)
				if (validatedParams.saveTarget) {
					const saveContent = `# Research Query: ${validatedParams.prompt}

**Detail Level:** ${result.detailLevel}
**Context Size:** ${result.contextSize} characters
**Timestamp:** ${new Date().toISOString()}

## Results

${result.result}
`;

					fs.writeFileSync(validatedParams.saveTarget, saveContent, 'utf-8');
					console.log(
						chalk.green(`\n💾 Results saved to: ${validatedParams.saveTarget}`)
					);
				}
			} catch (error) {
				console.error(chalk.red(`\n❌ Research failed: ${error.message}`));
				process.exit(1);
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
			const taskIds = options.id;
			const all = options.all;

			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag);

			if (!taskIds && !all) {
				console.error(
					chalk.red(
						'Error: Please specify task IDs with --id=<ids> or use --all to clear all tasks'
					)
				);
				process.exit(1);
			}

			if (all) {
				// If --all is specified, get all task IDs
				const data = readJSON(
					taskGraph.getTasksPath(),
					taskGraph.getProjectRoot(),
					tag
				);
				if (!data || !data.tasks) {
					console.error(chalk.red('Error: No valid tasks found'));
					process.exit(1);
				}
				const allIds = data.tasks.map((t) => t.id).join(',');
				clearSubtasks(taskGraph.getTasksPath(), allIds, {
					projectRoot: taskGraph.getProjectRoot(),
					tag
				});
			} else {
				clearSubtasks(taskGraph.getTasksPath(), taskIds, {
					projectRoot: taskGraph.getProjectRoot(),
					tag
				});
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
			'--priority <priority>',
			'Task priority (high, medium, low)',
			'medium'
		)
		.option(
			'-r, --research',
			'Whether to use research capabilities for task creation'
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

			const tasksPath = options.file || TASKGRAPH_TASKS_FILE;

			if (!fs.existsSync(tasksPath)) {
				console.error(
					`❌ No tasks.json file found. Please run "taskgraph init" or create a tasks.json file at ${TASKGRAPH_TASKS_FILE}`
				);
				process.exit(1);
			}

			// Correctly determine projectRoot
			// Initialize TaskGraph
			const taskGraph = initTaskGraph({
				tasksPath: options.file || true,
				tag: options.tag
			});

			const projectRoot = taskGraph.getProjectRoot();

			const tag = taskGraph.getCurrentTag();

			// Show current tag context
			await displayCurrentTagIndicator(tag);

			let manualTaskData = null;
			if (isManualCreation) {
				manualTaskData = {
					title: options.title,
					description: options.description,
					details: options.details || '',
					testStrategy: options.testStrategy || ''
				};
				// Restore specific logging for manual creation
				console.log(
					theme.brand(`Creating task manually with title: "${options.title}"`)
				);
			} else {
				// Restore specific logging for AI creation
				console.log(
					theme.brand(`Creating task with AI using prompt: "${options.prompt}"`)
				);
			}

			// Log dependencies and priority if provided (restored)
			const dependenciesArray = options.dependencies
				? options.dependencies.split(',').map((id) => id.trim())
				: [];
			if (dependenciesArray.length > 0) {
				console.log(
					theme.brand(`Dependencies: [${dependenciesArray.join(', ')}]`)
				);
			}
			if (options.priority) {
				console.log(theme.brand(`Priority: ${options.priority}`));
			}

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
					options.research
				);

				// addTask handles detailed CLI success logging AND telemetry display when outputFormat is 'text'
				// No need to call displayAiUsageSummary here anymore.
			} catch (error) {
				displayError(error, { hint: aiErrorHint(error) });
			}
		});

	// add-dependency command
	programInstance
		.command('add-dependency')
		.description('Add a dependency to a task')
		.option('-i, --id <id>', 'Task ID to add dependency to')
		.option('-d, --depends-on <id>', 'Task ID that will become a dependency')
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
			await displayCurrentTagIndicator(tag);

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

			await addDependency(
				taskGraph.getTasksPath(),
				formattedTaskId,
				formattedDependencyId,
				{
					projectRoot: taskGraph.getProjectRoot(),
					tag
				}
			);
		});

	// remove-dependency command
	programInstance
		.command('remove-dependency')
		.description('Remove a dependency from a task')
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
			await displayCurrentTagIndicator(tag);

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

			await removeDependency(
				taskGraph.getTasksPath(),
				formattedTaskId,
				formattedDependencyId,
				{
					projectRoot: taskGraph.getProjectRoot(),
					tag
				}
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
			await displayCurrentTagIndicator(tag);

			await validateDependenciesCommand(taskGraph.getTasksPath(), {
				context: { projectRoot: taskGraph.getProjectRoot(), tag }
			});
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
			await displayCurrentTagIndicator(tag);

			await fixDependenciesCommand(taskGraph.getTasksPath(), {
				context: { projectRoot: taskGraph.getProjectRoot(), tag }
			});
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
			await displayCurrentTagIndicator(taskGraph.getCurrentTag());

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
			'Comma-separated list of dependency IDs for the new subtask'
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
			await displayCurrentTagIndicator(tag);

			if (!parentId) {
				console.error(
					chalk.red(
						'Error: --parent parameter is required. Please provide a parent task ID.'
					)
				);
				showAddSubtaskHelp();
				process.exit(1);
			}

			// Parse dependencies if provided
			let dependencies = [];
			if (options.dependencies) {
				dependencies = options.dependencies.split(',').map((id) => {
					// Handle both regular IDs and dot notation
					return id.includes('.') ? id.trim() : parseInt(id.trim(), 10);
				});
			}

			try {
				if (existingTaskId) {
					// Convert existing task to subtask
					console.log(
						theme.brand(
							`Converting task ${existingTaskId} to a subtask of ${parentId}...`
						)
					);
					await addSubtask(
						taskGraph.getTasksPath(),
						parentId,
						existingTaskId,
						null,
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(
						chalk.green(
							`✓ Task ${existingTaskId} successfully converted to a subtask of task ${parentId}`
						)
					);
				} else if (options.title) {
					// Create new subtask with provided data
					console.log(
						theme.brand(`Creating new subtask for parent task ${parentId}...`)
					);

					const newSubtaskData = {
						title: options.title,
						description: options.description || '',
						details: options.details || '',
						status: options.status || 'pending',
						dependencies: dependencies
					};

					const subtask = await addSubtask(
						taskGraph.getTasksPath(),
						parentId,
						null,
						newSubtaskData,
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);
					console.log(
						chalk.green(
							`✓ New subtask ${parentId}.${subtask.id} successfully created`
						)
					);

					// Display success message and suggested next steps
					console.log(
						boxen(
							theme.text.bold(
								`Subtask ${parentId}.${subtask.id} Added Successfully`
							) +
								'\n\n' +
								theme.text(`Title: ${subtask.title}`) +
								'\n' +
								theme.text(`Status: ${getStatusWithColor(subtask.status)}`) +
								'\n' +
								(dependencies.length > 0
									? theme.text(`Dependencies: ${dependencies.join(', ')}`) +
										'\n'
									: '') +
								'\n' +
								theme.text.bold('Next Steps:') +
								'\n' +
								chalk.cyan(
									`1. Run ${chalk.yellow(`taskgraph show ${parentId}`)} to see the parent task with all subtasks`
								) +
								'\n' +
								chalk.cyan(
									`2. Run ${chalk.yellow(`tm set-status ${parentId}.${subtask.id} in-progress`)} to start working on it`
								),
							{
								padding: 1,
								borderColor: 'green',
								borderStyle: 'round',
								margin: { top: 1 }
							}
						)
					);
				} else {
					console.error(
						chalk.red('Error: Either --task-id or --title must be provided.')
					);
					console.log(
						boxen(
							theme.text.bold('Usage Examples:') +
								'\n\n' +
								theme.text('Convert existing task to subtask:') +
								'\n' +
								chalk.yellow(`  taskgraph add-subtask --parent=5 --task-id=8`) +
								'\n\n' +
								theme.text('Create new subtask:') +
								'\n' +
								chalk.yellow(
									`  taskgraph add-subtask --parent=5 --title="Implement login UI" --description="Create the login form"`
								) +
								'\n\n',
							{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
						)
					);
					process.exit(1);
				}
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showAddSubtaskHelp();
			process.exit(1);
		});

	// Helper function to show add-subtask command help
	function showAddSubtaskHelp() {
		console.log(
			boxen(
				`${theme.text.bold('Add Subtask Command Help')}\n\n${chalk.cyan('Usage:')}\n  taskgraph add-subtask --parent=<id> [options]\n\n${chalk.cyan('Options:')}\n  -p, --parent <id>         Parent task ID (required)\n  -i, --task-id <id>        Existing task ID to convert to subtask\n  -t, --title <title>       Title for the new subtask\n  -d, --description <text>  Description for the new subtask\n  --details <text>          Implementation details for the new subtask\n  --dependencies <ids>      Comma-separated list of dependency IDs\n  -s, --status <status>     Status for the new subtask (default: "pending")\n  -f, --file <file>         Path to the tasks file (default: "${TASKGRAPH_TASKS_FILE}")\n  --generate                Regenerate task files after adding subtask\n\n${chalk.cyan('Examples:')}\n  taskgraph add-subtask --parent=5 --task-id=8\n  taskgraph add-subtask -p 5 -t "Implement login UI" -d "Create the login form" --generate`,
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

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

			if (!subtaskIds) {
				console.error(
					chalk.red(
						'Error: --id parameter is required. Please provide subtask ID(s) in format "parentId.subtaskId".'
					)
				);
				showRemoveSubtaskHelp();
				process.exit(1);
			}

			try {
				// Split by comma to support multiple subtask IDs
				const subtaskIdArray = subtaskIds.split(',').map((id) => id.trim());

				for (const subtaskId of subtaskIdArray) {
					// Validate subtask ID format
					if (!subtaskId.includes('.')) {
						console.error(
							chalk.red(
								`Error: Subtask ID "${subtaskId}" must be in format "parentId.subtaskId"`
							)
						);
						showRemoveSubtaskHelp();
						process.exit(1);
					}

					console.log(theme.brand(`Removing subtask ${subtaskId}...`));
					if (convertToTask) {
						console.log(
							theme.brand('The subtask will be converted to a standalone task')
						);
					}

					const result = await removeSubtask(
						taskGraph.getTasksPath(),
						subtaskId,
						convertToTask,
						generateFiles,
						{ projectRoot: taskGraph.getProjectRoot(), tag }
					);

					if (convertToTask && result) {
						// Display success message and next steps for converted task
						console.log(
							boxen(
								theme.text.bold(
									`Subtask ${subtaskId} Converted to Task #${result.id}`
								) +
									'\n\n' +
									theme.text(`Title: ${result.title}`) +
									'\n' +
									theme.text(`Status: ${getStatusWithColor(result.status)}`) +
									'\n' +
									theme.text(
										`Dependencies: ${result.dependencies.join(', ')}`
									) +
									'\n\n' +
									theme.text.bold('Next Steps:') +
									'\n' +
									chalk.cyan(
										`1. Run ${chalk.yellow(`taskgraph show ${result.id}`)} to see details of the new task`
									) +
									'\n' +
									chalk.cyan(
										`2. Run ${chalk.yellow(`tm set-status ${result.id} in-progress`)} to start working on it`
									),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					} else {
						// Display success message for deleted subtask
						console.log(
							boxen(
								theme.text.bold(`Subtask ${subtaskId} Removed`) +
									'\n\n' +
									theme.text('The subtask has been successfully deleted.'),
								{
									padding: 1,
									borderColor: 'green',
									borderStyle: 'round',
									margin: { top: 1 }
								}
							)
						);
					}
				}
			} catch (error) {
				displayError(error);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showRemoveSubtaskHelp();
			process.exit(1);
		});

	// Helper function to show remove-subtask command help
	function showRemoveSubtaskHelp() {
		console.log(
			boxen(
				theme.text.bold('Remove Subtask Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph remove-subtask --id=<parentId.subtaskId> [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					'  -i, --id <id>       Subtask ID(s) to remove in format "parentId.subtaskId" (can be comma-separated, required)\n' +
					'  -c, --convert       Convert the subtask to a standalone task instead of deleting it\n' +
					'  -f, --file <file>   Path to the tasks file (default: "' +
					TASKGRAPH_TASKS_FILE +
					'")\n' +
					'  --skip-generate     Skip regenerating task files\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph remove-subtask --id=5.2\n' +
					'  taskgraph remove-subtask --id=5.2,6.3,7.1\n' +
					'  taskgraph remove-subtask --id=5.2 --convert',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

	// Helper function to show tags command help
	function showTagsHelp() {
		console.log(
			boxen(
				theme.text.bold('Tags Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph tags [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					'  -f, --file <file>   Path to the tasks file (default: "' +
					TASKGRAPH_TASKS_FILE +
					'")\n' +
					'  --show-metadata     Show detailed metadata for each tag\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph tags\n' +
					'  taskgraph tags --show-metadata\n\n' +
					chalk.cyan('Related Commands:') +
					'\n' +
					'  taskgraph add-tag <name>      Create a new tag\n' +
					'  taskgraph use-tag <name>      Switch to a tag\n' +
					'  taskgraph delete-tag <name>   Delete a tag',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

	// Helper function to show add-tag command help
	function showAddTagHelp() {
		console.log(
			boxen(
				theme.text.bold('Add Tag Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph add-tag <tagName> [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					'  -f, --file <file>        Path to the tasks file (default: "' +
					TASKGRAPH_TASKS_FILE +
					'")\n' +
					'  --copy-from-current      Copy tasks from the current tag to the new tag\n' +
					'  --copy-from <tag>        Copy tasks from the specified tag to the new tag\n' +
					'  -d, --description <text> Optional description for the tag\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph add-tag feature-xyz\n' +
					'  taskgraph add-tag feature-xyz --copy-from-current\n' +
					'  taskgraph add-tag feature-xyz --copy-from master\n' +
					'  taskgraph add-tag feature-xyz -d "Feature XYZ development"',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

	// Helper function to show delete-tag command help
	function showDeleteTagHelp() {
		console.log(
			boxen(
				theme.text.bold('Delete Tag Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph delete-tag <tagName> [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					'  -f, --file <file>   Path to the tasks file (default: "' +
					TASKGRAPH_TASKS_FILE +
					'")\n' +
					'  -y, --yes           Skip confirmation prompts\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph delete-tag feature-xyz\n' +
					'  taskgraph delete-tag feature-xyz --yes\n\n' +
					chalk.yellow('Warning:') +
					'\n' +
					'  This will permanently delete the tag and all its tasks!',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

	// Helper function to show use-tag command help
	function showUseTagHelp() {
		console.log(
			boxen(
				theme.text.bold('Use Tag Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph use-tag <tagName> [options]\n\n` +
					chalk.cyan('Options:') +
					'\n' +
					'  -f, --file <file>   Path to the tasks file (default: "' +
					TASKGRAPH_TASKS_FILE +
					'")\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph use-tag feature-xyz\n' +
					'  taskgraph use-tag master\n\n' +
					chalk.cyan('Related Commands:') +
					'\n' +
					'  taskgraph tags                 List all available tags\n' +
					'  taskgraph add-tag <name>       Create a new tag',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

	// Helper function to show research command help
	function showResearchHelp() {
		console.log(
			boxen(
				theme.text.bold('Research Command Help') +
					'\n\n' +
					chalk.cyan('Usage:') +
					'\n' +
					`  taskgraph research "<query>" [options]\n\n` +
					chalk.cyan('Required:') +
					'\n' +
					'  <query>             Research question or prompt (required)\n\n' +
					chalk.cyan('Context Options:') +
					'\n' +
					'  -i, --id <ids>      Comma-separated task/subtask IDs for context (e.g., "15,23.2")\n' +
					'  -f, --files <paths> Comma-separated file paths for context\n' +
					'  -c, --context <text> Additional custom context text\n' +
					'  --tree              Include project file tree structure\n\n' +
					chalk.cyan('Output Options:') +
					'\n' +
					'  -d, --detail <level> Detail level: low, medium, high (default: medium)\n' +
					'  --save-to <id>      Auto-save results to task/subtask ID (e.g., "15" or "15.2")\n' +
					'  --tag <tag>         Specify tag context for task operations\n\n' +
					chalk.cyan('Examples:') +
					'\n' +
					'  taskgraph research "How should I implement user authentication?"\n' +
					'  taskgraph research "What\'s the best approach?" --id=15,23.2\n' +
					'  taskgraph research "How does auth work?" --files=src/auth.js --tree\n' +
					'  taskgraph research "Implementation steps?" --save-to=15.2 --detail=high',
				{ padding: 1, borderColor: BORDER_COLOR, borderStyle: 'round' }
			)
		);
	}

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
			await displayCurrentTagIndicator(tag);

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
										t.dependencies.includes(parseInt(taskId, 10))
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

				const indicator = startLoadingIndicator(
					`Removing ${existingTasksToRemove.length} task(s)/subtask(s)...`
				);

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

				stopLoadingIndicator(indicator);

				if (result.success) {
					console.log(
						boxen(
							chalk.green(
								`Successfully removed ${result.removedTasks.length} task(s)/subtask(s).`
							) +
								(result.message ? `\n\nDetails:\n${result.message}` : '') +
								(result.error
									? `\n\nWarnings:\n${chalk.yellow(result.error)}`
									: ''),
							{ padding: 1, borderColor: 'green', borderStyle: 'round' }
						)
					);
				} else {
					console.error(
						boxen(
							chalk.red(
								`Operation completed with errors. Removed ${result.removedTasks.length} task(s)/subtask(s).`
							) +
								(result.message ? `\n\nDetails:\n${result.message}` : '') +
								(result.error ? `\n\nErrors:\n${chalk.red(result.error)}` : ''),
							{
								padding: 1,
								borderColor: 'red',
								borderStyle: 'round'
							}
						)
					);
					process.exit(1); // Exit with error code if any part failed
				}

				// Log any initially non-existent IDs again for clarity
				if (nonExistentIds.length > 0) {
					console.warn(
						chalk.yellow(
							`Note: The following IDs were not found initially and were skipped: ${nonExistentIds.join(', ')}`
						)
					);

					// Exit with error if any removals failed
					if (result.removedTasks.length === 0) {
						process.exit(1);
					}
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
		.option('--skip-install', 'Skip installing dependencies')
		.option('--dry-run', 'Show what would be done without making changes')
		.option('--aliases', 'Add shell aliases (tm, taskgraph)')
		.option('--no-aliases', 'Skip shell aliases (tm, taskgraph)')
		.option('--git', 'Initialize Git repository')
		.option('--no-git', 'Skip Git repository initialization')
		.option('--git-tasks', 'Store tasks in Git')
		.option('--no-git-tasks', 'No Git storage of tasks')
		.action(async (cmdOptions) => {
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
					console.error(
						chalk.red(
							`Unsupported rule profile(s): ${invalidProfiles.join(', ')}. TaskGraph supports Claude Code only; valid options: ${RULE_PROFILES.join(', ')}`
						)
					);
					process.exit(1);
				}
				if (userSpecifiedProfiles.length > 0) {
					selectedProfiles = userSpecifiedProfiles;
					rulesExplicitlyProvided = true;
				}
			}

			cmdOptions.rules = selectedProfiles;
			cmdOptions.rulesExplicitlyProvided = rulesExplicitlyProvided;

			try {
				// Directly call the initializeProject function, passing the parsed options
				await initializeProject(cmdOptions);
				// initializeProject handles its own flow, including potential process.exit()
			} catch (error) {
				console.error(
					chalk.red(`Error during initialization: ${error.message}`)
				);
				process.exit(1);
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
				console.error(
					chalk.red(
						'Error: TaskGraph now uses Claude Code only, so provider flags such as --ollama, --openrouter and --baseURL are no longer supported.'
					)
				);
				console.error(
					chalk.yellow(
						'Choose one of the Claude Code models: taskgraph models --set-main <opus|sonnet|haiku>'
					)
				);
				process.exit(1);
			}

			if (options.setup) {
				console.log(theme.brand('Starting interactive model setup...'));
				try {
					await runInteractiveSetup(projectRoot);
					// runInteractiveSetup logs its own completion/error messages
				} catch (setupError) {
					console.error(
						chalk.red('\nInteractive setup failed unexpectedly:'),
						setupError.message
					);
				}
				return;
			}

			const requestedChanges = [
				['main', options.setMain],
				['research', options.setResearch],
				['fallback', options.setFallback]
			].filter(([, modelId]) => modelId);

			if (requestedChanges.length > 0) {
				let updateOccurred = false;

				for (const [role, modelId] of requestedChanges) {
					const result = await setModel(role, modelId, { projectRoot });
					if (result.success) {
						console.log(chalk.green(`✅ ${result.data.message}`));
						updateOccurred = true;
					} else {
						console.error(
							chalk.red(
								`❌ Error setting ${role} model: ${result.error.message}`
							)
						);
					}
				}

				if (updateOccurred) {
					console.log(theme.brand('\nModel configuration updated.'));
				} else {
					console.log(
						chalk.yellow(
							'\nNo model configuration changes were made (or errors occurred).'
						)
					);
				}
				return;
			}

			// Display full status when no setup or set flags were given
			console.log(theme.brand('Fetching current model configuration...'));
			const configResult = await getModelConfiguration({ projectRoot });
			const availableResult = await getAvailableModelsList({ projectRoot });

			if (!configResult.success) {
				console.error(
					chalk.red(
						`❌ Error fetching configuration: ${configResult.error.message}`
					)
				);
			} else {
				displayModelConfiguration(
					configResult.data,
					availableResult.data?.models || []
				);
			}

			if (availableResult.success) {
				const activeIds = configResult.success
					? [
							configResult.data.activeModels.main.modelId,
							configResult.data.activeModels.research.modelId,
							configResult.data.activeModels.fallback?.modelId
						].filter(Boolean)
					: [];
				displayAvailableModels(
					availableResult.data.models.filter(
						(m) => !activeIds.includes(m.modelId)
					)
				);
			} else {
				console.error(
					chalk.yellow(
						`⚠️ Warning: Could not display available models: ${availableResult.error.message}`
					)
				);
			}

			if (!isConfigFilePresent(projectRoot)) {
				console.log(
					chalk.yellow(
						"\nHint: Run 'taskgraph models --setup' to create or update your configuration."
					)
				);
			}
		});

	// response-language command
	programInstance
		.command('lang')
		.description('Manage response language settings')
		.option('--response <response_language>', 'Set the response language')
		.option('--setup', 'Run interactive setup to configure response language')
		.action(async (options) => {
			const taskGraph = initTaskGraph({});
			const projectRoot = taskGraph.getProjectRoot(); // Find project root for context
			const { response, setup } = options;
			let responseLanguage = response !== undefined ? response : 'English';
			if (setup) {
				console.log(
					theme.brand('Starting interactive response language setup...')
				);
				try {
					const userResponse = await inquirer.prompt([
						{
							type: 'input',
							name: 'responseLanguage',
							message: 'Input your preferred response language',
							default: 'English'
						}
					]);

					console.log(
						theme.brand(
							'Response language set to:',
							userResponse.responseLanguage
						)
					);
					responseLanguage = userResponse.responseLanguage;
				} catch (setupError) {
					console.error(
						chalk.red('\\nInteractive setup failed unexpectedly:'),
						setupError.message
					);
				}
			}

			const result = setResponseLanguage(responseLanguage, {
				projectRoot
			});

			if (result.success) {
				console.log(chalk.green(`✅ ${result.data.message}`));
			} else {
				console.error(
					chalk.red(
						`❌ Error setting response language: ${result.error.message}`
					)
				);
				process.exit(1);
			}
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

						console.log(
							theme.brand(`Moving task/subtask ${fromId} to ${toId}...`)
						);
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
					console.log(
						theme.brand(
							`Moving task/subtask ${sourceId} to ${destinationId}...`
						)
					);

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
				// A missing ID needs only the message and where to find IDs
				if (/not found/i.test(error.message)) {
					displayError(error);
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

	// add-tag command (DEPRECATED - use `tm tags add` instead)
	programInstance
		.command('add-tag')
		.description(
			'[DEPRECATED] Create a new tag context for organizing tasks (use "tm tags add" instead)'
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
			// Show deprecation warning
			console.warn(
				chalk.yellow(
					'⚠ Warning: "tm add-tag" is deprecated. Use "tm tags add" instead.'
				)
			);
			console.log(
				theme.muted('  This command will be removed in a future version.\n')
			);

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
					console.log(
						chalk.yellow(
							'Hint: Run taskgraph init or taskgraph parse-prd to create tasks.json first'
						)
					);
					process.exit(1);
				}

				// Validate that either tagName is provided or --from-branch is used
				if (!tagName && !options.fromBranch) {
					console.error(
						chalk.red(
							'Error: Either tagName argument or --from-branch option is required.'
						)
					);
					console.log(chalk.yellow('Usage examples:'));
					console.log(chalk.cyan('  taskgraph add-tag my-tag'));
					console.log(chalk.cyan('  taskgraph add-tag --from-branch'));
					process.exit(1);
				}

				const context = {
					projectRoot: taskGraph.getProjectRoot(),
					commandName: 'add-tag',
					outputType: 'cli'
				};

				// Handle --from-branch option
				if (options.fromBranch) {
					const { createTagFromBranch } = await import(
						'./task-manager/tag-management.js'
					);
					const gitUtils = await import('./utils/git-utils.js');

					// Check if we're in a git repository
					if (!(await gitUtils.isGitRepository(context.projectRoot))) {
						console.error(
							chalk.red(
								'Error: Not in a git repository. Cannot use --from-branch option.'
							)
						);
						process.exit(1);
					}

					// Get current git branch
					const currentBranch = await gitUtils.getCurrentBranch(
						context.projectRoot
					);
					if (!currentBranch) {
						console.error(
							chalk.red('Error: Could not determine current git branch.')
						);
						process.exit(1);
					}

					// Create tag from branch
					const branchOptions = {
						copyFromCurrent: options.copyFromCurrent || false,
						copyFromTag: options.copyFrom,
						description:
							options.description ||
							`Tag created from git branch "${currentBranch}"`
					};

					await createTagFromBranch(
						taskGraph.getTasksPath(),
						currentBranch,
						branchOptions,
						context,
						'text'
					);
				} else {
					// Regular tag creation
					const createOptions = {
						copyFromCurrent: options.copyFromCurrent || false,
						copyFromTag: options.copyFrom,
						description: options.description
					};

					await createTag(
						taskGraph.getTasksPath(),
						tagName,
						createOptions,
						context,
						'text'
					);
				}

				// Handle auto-switch if requested
				if (options.autoSwitch) {
					const { useTag } = await import('./task-manager/tag-management.js');
					const finalTagName = options.fromBranch
						? (await import('./utils/git-utils.js')).sanitizeBranchNameForTag(
								await (await import('./utils/git-utils.js')).getCurrentBranch(
									projectRoot
								)
							)
						: tagName;
					await useTag(
						taskGraph.getTasksPath(),
						finalTagName,
						{},
						context,
						'text'
					);
				}
			} catch (error) {
				console.error(chalk.red(`Error creating tag: ${error.message}`));
				showAddTagHelp();
				process.exit(1);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showAddTagHelp();
			process.exit(1);
		});

	// delete-tag command (DEPRECATED - use `tm tags remove` instead)
	programInstance
		.command('delete-tag')
		.description(
			'[DEPRECATED] Delete an existing tag and all its tasks (use "tm tags remove" instead)'
		)
		.argument('<tagName>', 'Name of the tag to delete')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-y, --yes', 'Skip confirmation prompts')
		.action(async (tagName, options) => {
			// Show deprecation warning
			console.warn(
				chalk.yellow(
					'⚠ Warning: "tm delete-tag" is deprecated. Use "tm tags remove" instead.'
				)
			);
			console.log(
				theme.muted('  This command will be removed in a future version.\n')
			);

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
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
				console.error(chalk.red(`Error deleting tag: ${error.message}`));
				showDeleteTagHelp();
				process.exit(1);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			showDeleteTagHelp();
			process.exit(1);
		});

	// tags command - REMOVED
	// This command has been replaced by the new CommandRegistry-based TagsCommand
	// in apps/cli/src/commands/tags.command.ts
	// The old implementation is no longer needed

	// use-tag command (DEPRECATED - use `tm tags use` instead)
	programInstance
		.command('use-tag')
		.description(
			'[DEPRECATED] Switch to a different tag context (use "tm tags use" instead)'
		)
		.argument('<tagName>', 'Name of the tag to switch to')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.action(async (tagName, options) => {
			// Show deprecation warning
			console.warn(
				chalk.yellow(
					'⚠ Warning: "taskgraph use-tag" is deprecated. Use "taskgraph tags use" instead.'
				)
			);
			console.log(
				theme.muted('  This command will be removed in a future version.\n')
			);

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
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
			console.error(chalk.red(`Error: ${err.message}`));
			showUseTagHelp();
			process.exit(1);
		});

	// rename-tag command (DEPRECATED - use `tm tags rename` instead)
	programInstance
		.command('rename-tag')
		.description(
			'[DEPRECATED] Rename an existing tag (use "tm tags rename" instead)'
		)
		.argument('<oldName>', 'Current name of the tag')
		.argument('<newName>', 'New name for the tag')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.action(async (oldName, newName, options) => {
			// Show deprecation warning
			console.warn(
				chalk.yellow(
					'⚠ Warning: "tm rename-tag" is deprecated. Use "tm tags rename" instead.'
				)
			);
			console.log(
				theme.muted('  This command will be removed in a future version.\n')
			);

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
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
				console.error(chalk.red(`Error renaming tag: ${error.message}`));
				process.exit(1);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			process.exit(1);
		});

	// copy-tag command (DEPRECATED - use `tm tags copy` instead)
	programInstance
		.command('copy-tag')
		.description(
			'[DEPRECATED] Copy an existing tag to create a new tag with the same tasks (use "tm tags copy" instead)'
		)
		.argument('<sourceName>', 'Name of the source tag to copy from')
		.argument('<targetName>', 'Name of the new tag to create')
		.option('-f, --file <file>', 'Path to the tasks file', TASKGRAPH_TASKS_FILE)
		.option('-d, --description <text>', 'Optional description for the new tag')
		.action(async (sourceName, targetName, options) => {
			// Show deprecation warning
			console.warn(
				chalk.yellow(
					'⚠ Warning: "tm copy-tag" is deprecated. Use "tm tags copy" instead.'
				)
			);
			console.log(
				theme.muted('  This command will be removed in a future version.\n')
			);

			try {
				// Initialize TaskGraph
				const taskGraph = initTaskGraph({
					tasksPath: options.file || true
				});
				const tasksPath = taskGraph.getTasksPath();

				// Validate tasks file exists
				if (!fs.existsSync(tasksPath)) {
					console.error(
						chalk.red(`Error: Tasks file not found at path: ${tasksPath}`)
					);
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
				console.error(chalk.red(`Error copying tag: ${error.message}`));
				process.exit(1);
			}
		})
		.on('error', function (err) {
			console.error(chalk.red(`Error: ${err.message}`));
			process.exit(1);
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
 * Load the TUI module (coming soon)
 * @returns {Promise<object|null>} null - TUI not yet available
 */
async function loadTUI() {
	// TUI is coming soon - return null for now
	return null;
}

/**
 * Launch the interactive TUI REPL
 */
async function launchREPL() {
	const tui = await loadTUI();

	if (!tui) {
		// TUI coming soon - show help for now
		console.log(chalk.yellow('TUI mode coming soon!'));
		console.log(chalk.dim('Showing help instead...\n'));
		displayHelp();
		return;
	}

	// Only import react once a TUI exists; it is not a declared dependency
	const React = await import('react');
	const { render, Shell } = tui;

	// Get current context
	let tag = 'master';
	let projectRoot = process.cwd();

	try {
		const taskGraph = initTaskGraph({});
		tag = taskGraph.getCurrentTag();
		projectRoot = taskGraph.getProjectRoot() || process.cwd();
	} catch (error) {
		// Use defaults
	}

	// Check if stdin supports raw mode (required for interactive TUI)
	const isInteractive =
		process.stdin.isTTY && typeof process.stdin.setRawMode === 'function';

	// Clear screen
	console.clear();

	// Shell props with interactive flag and auth state
	const shellProps = {
		showBanner: true,
		showSplash: isInteractive,
		initialTag: tag,
		isInteractive: isInteractive,
		projectRoot: projectRoot,
		onExit: () => {
			console.log(chalk.dim('\nGoodbye! 👋'));
			process.exit(0);
		}
	};

	const instance = render(React.createElement(Shell, shellProps));

	// In non-interactive mode, wait for render then exit
	if (!isInteractive) {
		setTimeout(() => {
			instance.unmount();
			console.log(
				chalk.dim('\n💡 Run in an interactive terminal for full REPL mode.')
			);
			process.exit(0);
		}, 200);
	}
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

	return programInstance;
}

/**
 * Parse arguments and run the CLI
 * @param {Array} argv - Command-line arguments
 */
async function runCLI(argv = process.argv) {
	try {
		// If no arguments provided, launch the TUI REPL (which has its own banner)
		if (argv.length <= 2) {
			await launchREPL();
			return;
		}

		// Display banner if not in a pipe (except for init/start/repl commands which have their own)
		const isInitCommand = argv.includes('init');
		const isREPLCommand = argv.includes('tui') || argv.includes('repl');
		const noBanner = argv.includes('--no-banner');
		if (process.stdout.isTTY && !isInitCommand && !isREPLCommand && !noBanner) {
			displayBanner();
		}

		// Check for updates BEFORE executing the command (skip entirely in test/CI mode)
		// `completion` output is usually redirected into a file, so nothing else
		// may be printed to stdout before or after it
		const isCompletion = argv[2] === 'completion';
		const skipAutoUpdate =
			process.env.TASKGRAPH_SKIP_AUTO_UPDATE === '1' ||
			process.env.CI ||
			process.env.NODE_ENV === 'test' ||
			isCompletion;

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
		// NOTE: getConfig() might be called during setupCLI->registerCommands if commands need config
		// This means the ConfigurationError might be thrown here if configuration file is missing.
		const programInstance = setupCLI();
		// Filter out --no-banner since it's handled above and not a Commander option
		const filteredArgv = argv.filter((arg) => arg !== '--no-banner');
		await programInstance.parseAsync(filteredArgv);

		// Check if migration has occurred and show FYI notice once
		try {
			if (isCompletion) return;
			// Use initTaskGraph with no required fields - will only fail if no project root
			const taskGraph = initTaskGraph({});

			const tasksPath = taskGraph.getTasksPath();
			const statePath = taskGraph.getStatePath();

			if (tasksPath && fs.existsSync(tasksPath)) {
				// Read raw file to check if it has master key (bypassing tag resolution)
				const rawData = fs.readFileSync(tasksPath, 'utf8');
				const parsedData = JSON.parse(rawData);

				if (parsedData && parsedData.master) {
					// Migration has occurred, check if we've shown the notice
					let stateData = { migrationNoticeShown: false };
					if (statePath && fs.existsSync(statePath)) {
						// Read state.json directly without tag resolution since it's not a tagged file
						const rawStateData = fs.readFileSync(statePath, 'utf8');
						stateData = JSON.parse(rawStateData) || stateData;
					}

					if (!stateData.migrationNoticeShown) {
						displayTaggedTasksFYI({ _migrationHappened: true });

						// Mark as shown
						stateData.migrationNoticeShown = true;
						// Write state.json directly without tag resolution since it's not a tagged file
						if (statePath) {
							fs.writeFileSync(statePath, JSON.stringify(stateData, null, 2));
						}
					}
				}
			}
		} catch (error) {
			// Silently ignore errors checking for migration notice
		}
	} catch (error) {
		// ** Specific catch block for missing configuration file **
		if (error instanceof ConfigurationError) {
			console.error(
				boxen(
					chalk.red.bold('Configuration Update Required!') +
						'\n\n' +
						theme.text('TaskGraph now uses a ') +
						chalk.yellow.bold('configuration file') +
						theme.text(
							' in your project for AI model choices and settings.\n\n' +
								'This file appears to be '
						) +
						chalk.red.bold('missing') +
						theme.text('. No worries though.\n\n') +
						chalk.cyan.bold('To create this file, run the interactive setup:') +
						'\n' +
						chalk.green('   taskgraph models --setup') +
						'\n\n' +
						theme.text.bold('Key Points:') +
						'\n' +
						theme.text('*   ') +
						chalk.yellow.bold('Configuration file') +
						theme.text(
							': Stores your AI model settings (do not manually edit)\n'
						) +
						theme.text('*   ') +
						chalk.yellow.bold('.env & .mcp.json') +
						theme.text(': Still used ') +
						chalk.red.bold('only') +
						theme.text(' for your AI provider API keys.\n\n') +
						chalk.cyan(
							'`taskgraph models` to check your config & available models\n'
						) +
						chalk.cyan(
							'`taskgraph models --setup` to adjust the AI models used by TaskGraph'
						),
					{
						padding: 1,
						margin: { top: 1 },
						borderColor: 'red',
						borderStyle: 'round'
					}
				)
			);
		} else {
			// Generic error handling for other errors
			displayError(error);
		}

		process.exit(1);
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
