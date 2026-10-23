/**
 * TaskGraph
 * Copyright (c) 2025 Eyal Toledano, Ralph Khreish
 *
 * This software is licensed under the MIT License with Commons Clause.
 * You may use this software for any purpose, including commercial applications,
 * and modify and redistribute it freely, subject to the following restrictions:
 *
 * 1. You may not sell this software or offer it as a service.
 * 2. The origin of this software must not be misrepresented.
 * 3. Altered source versions must be plainly marked as such.
 *
 * For the full license text, see the LICENSE file in the root directory.
 */

import { randomUUID } from 'crypto';
import path from 'path';
import readline from 'readline';
import { ui } from '@tm/cli';
import chalk from 'chalk';
import {
	ENV_EXAMPLE_FILE,
	GITIGNORE_FILE,
	TASKGRAPH_DIR
} from '../src/constants/paths.js';
import { RULE_PROFILES } from '../src/constants/profiles.js';
import { readStoreTasksInGit } from '../src/utils/manage-gitignore.js';
import { GITATTRIBUTES_FILE } from './modules/init-changes.js';
import { log } from './modules/init-log.js';
import { createInitialTasksFile } from './modules/init-project-files.js';
import {
	createProjectStructure,
	setUpMergeDriver
} from './modules/init-project-structure.js';
import * as upstream from './modules/init-upstream-import.js';
import { isSilentMode } from './modules/utils.js';
import { insideGitWorkTree } from './modules/utils/git-utils.js';

/**
 * Display a fancy banner for initialization
 * Delegates to @tm/cli brand banner component
 */
function displayBanner() {
	if (isSilentMode()) return;
	ui.displayInitBanner();
}

// Main function to initialize a new project
async function initializeProject(options = {}) {
	// Receives options as argument
	upstream.ensureUpstreamImportCanRun(options, process.cwd());
	// Only display banner if not in silent mode
	if (!isSilentMode()) {
		displayBanner();
	}

	// Debug logging only if not in silent mode
	// if (!isSilentMode()) {
	// 	console.log('===== DEBUG: INITIALIZE PROJECT OPTIONS RECEIVED =====');
	// 	console.log('Full options object:', JSON.stringify(options));
	// 	console.log('options.yes:', options.yes);
	// 	console.log('==================================================');
	// }

	// Handle boolean git flags
	if (options.git === true) {
		options.initGit = true; // --git flag provided
	} else if (options.git === false) {
		options.initGit = false; // --no-git flag provided
	}
	// If options.git and options.noGit are undefined, we'll prompt for it

	// Handle boolean gitTasks flags
	if (options.gitTasks === true) {
		options.storeTasksInGit = true; // --git-tasks flag provided
	} else if (options.gitTasks === false) {
		options.storeTasksInGit = false; // --no-git-tasks flag provided
	}
	// If options.gitTasks and options.noGitTasks are undefined, we'll prompt for it

	const skipPrompts = options.yes || (options.name && options.description);

	// if (!isSilentMode()) {
	// 	console.log('Skip prompts determined:', skipPrompts);
	// }

	// Claude Code integration is on unless --no-claude: --yes and the
	// interactive prompt's default both set it up
	let selectedRuleProfiles;
	if (options.claude === false) {
		selectedRuleProfiles = [];
	} else if (options.rulesExplicitlyProvided) {
		selectedRuleProfiles = options.rules;
	} else {
		selectedRuleProfiles = RULE_PROFILES;
	}

	if (skipPrompts) {
		// Use provided options or defaults
		const projectName = options.name || 'taskgraph-project';
		const projectDescription =
			options.description || 'A project managed with TaskGraph';
		const projectVersion = options.version || '0.1.0';
		const authorName = options.author || 'Vibe coder';
		const dryRun = options.dryRun || false;
		const initGit = options.initGit !== undefined ? options.initGit : true; // Default to true if not specified
		// No flag: keep what an earlier init chose, else store tasks in Git
		const storeTasksInGit =
			options.storeTasksInGit ??
			readStoreTasksInGit(path.join(process.cwd(), GITIGNORE_FILE)) ??
			true;

		if (dryRun) {
			displayDryRun(initGit, storeTasksInGit, options, selectedRuleProfiles);
			return {
				dryRun: true
			};
		}

		await createProjectStructure(
			options.aliases !== false, // --no-aliases opts out
			initGit,
			storeTasksInGit,
			dryRun,
			{ ...options, preferredLanguage: 'English' }, // Default to English in non-interactive mode
			selectedRuleProfiles
		);
	} else {
		// Interactive logic
		log('debug', 'Required options not provided, proceeding with prompts.');

		let rl;

		try {
			// Track init_started event
			// TODO: Send to Segment telemetry when implemented
			const taskgraphId = generateTaskGraphId();
			log('debug', `Init started - taskgraph_id: ${taskgraphId}`);

			rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});

			let initGitPrompted = true; // Default to true
			let storeGitPrompted = true; // Default to true

			// Prompt for Git initialization (skip if --git or --no-git flag was
			// provided, or if there's already a repository to use)
			if (options.initGit !== undefined) {
				initGitPrompted = options.initGit; // Use flag value if provided
			} else if (insideGitWorkTree()) {
				initGitPrompted = true; // Nothing to ask; init won't run git init
			} else {
				const gitInitInput = await promptQuestion(
					rl,
					chalk.cyan('Initialize a Git repository in project root? (Y/n): '),
					(answer) => {
						const isYes = answer.trim().toLowerCase() !== 'n';
						// ✗ means an error elsewhere; a No answer isn't one
						const icon = isYes ? chalk.green('✓') : chalk.dim('–');
						return (
							chalk.cyan('Initialize a Git repository in project root?') +
							' ' +
							icon +
							' ' +
							chalk.dim(isYes ? 'Yes' : 'No')
						);
					}
				);
				initGitPrompted = gitInitInput.trim().toLowerCase() !== 'n';
			}

			// Prompt for Git tasks storage (skip if --git-tasks or --no-git-tasks flag was provided)
			if (options.storeTasksInGit !== undefined) {
				storeGitPrompted = options.storeTasksInGit; // Use flag value if provided
			} else {
				const gitTasksInput = await promptQuestion(
					rl,
					chalk.cyan(
						'Store tasks in Git (tasks.json and tasks/ directory)? (Y/n): '
					),
					(answer) => {
						const isYes = answer.trim().toLowerCase() !== 'n';
						// ✗ means an error elsewhere; a No answer isn't one
						const icon = isYes ? chalk.green('✓') : chalk.dim('–');
						return (
							chalk.cyan(
								'Store tasks in Git (tasks.json and tasks/ directory)?'
							) +
							' ' +
							icon +
							' ' +
							chalk.dim(isYes ? 'Yes' : 'No')
						);
					}
				);
				storeGitPrompted = gitTasksInput.trim().toLowerCase() !== 'n';
			}

			// Ask about the Claude Code integration unless --claude, --no-claude
			// or --rules already answered; Enter accepts it
			let shouldSetupRules = selectedRuleProfiles.length > 0;
			if (options.claude === undefined && !options.rulesExplicitlyProvided) {
				const setupRulesInput = await promptQuestion(
					rl,
					chalk.cyan(
						'Set up Claude Code integration (CLAUDE.md import)? (Y/n): '
					),
					(answer) => {
						const isYes = answer.trim().toLowerCase() !== 'n';
						// ✗ means an error elsewhere; a No answer isn't one
						const icon = isYes ? chalk.green('✓') : chalk.dim('–');
						return (
							chalk.cyan('Set up Claude Code integration?') +
							' ' +
							icon +
							' ' +
							chalk.dim(isYes ? 'Yes' : 'No')
						);
					}
				);
				shouldSetupRules = setupRulesInput.trim().toLowerCase() !== 'n';
			} else {
				log(
					'debug',
					`Claude Code integration from flags: ${shouldSetupRules ? 'on' : 'off'}`
				);
			}

			// Prompt for response language preference
			const languageInput = await promptQuestion(
				rl,
				chalk.cyan('Language for AI responses (English): '),
				(answer) =>
					`${chalk.cyan('Language for AI responses?')} ${chalk.dim(answer.trim() || 'English')}`
			);
			const preferredLanguage = languageInput.trim() || 'English';
			// Each answer already shows on its own line; no second confirmation

			const dryRun = options.dryRun || false;

			if (dryRun) {
				rl.close();
				displayDryRun(
					initGitPrompted,
					storeGitPrompted,
					options,
					shouldSetupRules ? selectedRuleProfiles : []
				);
				return {
					dryRun: true
				};
			}

			// Create structure using only necessary values
			// addShellAliases() skips aliases that already exist
			await createProjectStructure(
				options.aliases !== false, // --no-aliases opts out
				initGitPrompted,
				storeGitPrompted,
				dryRun,
				{ ...options, shouldSetupRules, preferredLanguage }, // Pass shouldSetupRules and preferredLanguage through options
				shouldSetupRules ? selectedRuleProfiles : []
			);
			rl.close();
		} catch (error) {
			if (rl) {
				rl.close();
			}
			log('error', `Error during initialization process: ${error.message}`);
			process.exit(1);
		}
	}
}

// Helper function to promisify readline question and overwrite prompt with result
function promptQuestion(rl, question, formatResult) {
	return new Promise((resolve) => {
		rl.question(question, (answer) => {
			// After user presses Enter, cursor is on a new line
			// Move cursor up one line, then clear and write result
			readline.moveCursor(process.stdout, 0, -1);
			readline.cursorTo(process.stdout, 0);
			readline.clearLine(process.stdout, 0);
			// Show formatted result if provided
			if (formatResult) {
				process.stdout.write(formatResult(answer) + '\n');
			}
			resolve(answer);
		});
	});
}

/**
 * Generate a unique taskgraph_id for anonymous tracking
 * @returns {string} UUID string
 */
function generateTaskGraphId() {
	return randomUUID();
}

/**
 * Say what init would do without doing it.
 * @param {boolean} initGit - Whether git init would run
 * @param {boolean} storeTasksInGit - Whether tasks would be committed
 * @param {object} [options] - init's options, for the import and MCP flags
 * @param {string[]} [ruleProfiles] - Profiles init would install
 */
function displayDryRun(initGit, storeTasksInGit, options, ruleProfiles = []) {
	if (isSilentMode()) return;
	const lines = [
		'Dry run; nothing was changed. Init would:',
		`  create ${TASKGRAPH_DIR}/ with tasks, settings and PRD templates`,
		...upstream.upstreamImportDryRunLines(options),
		`  create or update ${GITIGNORE_FILE} and ${ENV_EXAMPLE_FILE}`
	];
	if (initGit !== false && !insideGitWorkTree()) {
		lines.push('  start a Git repository');
	}
	if (storeTasksInGit && (initGit !== false || insideGitWorkTree())) {
		lines.push(
			`  set up Git to merge tasks.json by task (${GITATTRIBUTES_FILE})`
		);
	}
	lines.push(
		storeTasksInGit ? '  keep tasks in Git' : '  keep tasks out of Git'
	);
	if (ruleProfiles.includes('claude')) {
		lines.push(
			options?.mcp
				? '  import TaskGraph’s guide in CLAUDE.md and add the MCP server to .mcp.json'
				: '  import TaskGraph’s guide in CLAUDE.md'
		);
	}
	console.log(lines.join('\n'));
}

// Ensure necessary functions are exported
export { createInitialTasksFile, initializeProject, log, setUpMergeDriver };
