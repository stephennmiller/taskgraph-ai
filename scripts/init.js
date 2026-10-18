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
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { authenticateWithBrowserMFA, ensureOrgSelected, ui } from '@tm/cli';
import { AuthManager } from '@tm/core';
import boxen from 'boxen';
import chalk from 'chalk';
import figlet from 'figlet';
import gradient from 'gradient-string';
import inquirer from 'inquirer';
import open from 'open';
import ora from 'ora';
import { RULE_PROFILES } from '../src/constants/profiles.js';
import { manageGitignoreFile } from '../src/utils/manage-gitignore.js';
import {
	convertAllRulesToProfileRules,
	getRulesProfile
} from '../src/utils/rule-transformer.js';
import { getLocalGettingStartedMessage } from './modules/init-next-steps.js';
import { brandGradient } from './modules/ui.js';
import { updateConfigMaxTokens } from './modules/update-config-tokens.js';
import { isSilentMode } from './modules/utils.js';
import { insideGitWorkTree } from './modules/utils/git-utils.js';

// Import asset resolver
import { assetExists, readAsset } from '../src/utils/asset-resolver.js';

import { execSync } from 'child_process';
import { theme } from '@tm/cli/theme';
import {
	ENV_EXAMPLE_FILE,
	EXAMPLE_PRD_FILE,
	GITIGNORE_FILE,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_DIR,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_REPORTS_DIR,
	TASKGRAPH_STATE_FILE,
	TASKGRAPH_TASKS_DIR,
	TASKGRAPH_TEMPLATES_DIR
} from '../src/constants/paths.js';

// Define box width for boxen displays
const BOX_WIDTH = 60;

// Define log levels
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	success: 4
};

// Determine log level from environment variable or default to 'info'
const LOG_LEVEL = process.env.TASKGRAPH_LOG_LEVEL
	? LOG_LEVELS[process.env.TASKGRAPH_LOG_LEVEL.toLowerCase()]
	: LOG_LEVELS.info; // Default to info

/**
 * Display a fancy banner for initialization
 * Delegates to @tm/cli brand banner component
 */
function displayBanner() {
	if (isSilentMode()) return;
	ui.displayInitBanner();
}

// Logging function with icons and colors
function log(level, ...args) {
	const icons = {
		debug: theme.muted('•'),
		info: theme.brand('→'),
		warn: chalk.yellow('!'),
		error: chalk.red('✗'),
		success: chalk.green('✓')
	};

	if (LOG_LEVELS[level] >= LOG_LEVEL) {
		const icon = icons[level] || '';

		// Only output to console if not in silent mode
		if (!isSilentMode()) {
			if (level === 'error') {
				console.error(icon, chalk.red(...args));
			} else if (level === 'warn') {
				console.warn(icon, chalk.yellow(...args));
			} else if (level === 'success') {
				console.log(icon, chalk.green(...args));
			} else if (level === 'info') {
				console.log(icon, theme.brand(...args));
			} else {
				console.log(icon, ...args);
			}
		}
	}

	// Write to debug log if DEBUG=true
	if (process.env.DEBUG === 'true') {
		const logMessage = `[${level.toUpperCase()}] ${args.join(' ')}\n`;
		fs.appendFileSync('init-debug.log', logMessage);
	}
}

// Function to create directory if it doesn't exist
function ensureDirectoryExists(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		log('info', `Created directory: ${dirPath}`);
	}
}

// Function to add shell aliases to the user's shell configuration
// Silently checks each alias individually and adds only missing ones
function addShellAliases() {
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	let shellConfigFile;

	// Determine which shell config file to use
	if (process.env.SHELL?.includes('zsh')) {
		shellConfigFile = path.join(homeDir, '.zshrc');
	} else if (process.env.SHELL?.includes('bash')) {
		shellConfigFile = path.join(homeDir, '.bashrc');
	} else {
		log('debug', 'Could not determine shell type. Aliases not added.');
		return false;
	}

	try {
		// Check if file exists
		if (!fs.existsSync(shellConfigFile)) {
			log('debug', `Shell config file ${shellConfigFile} not found.`);
			return false;
		}

		const configContent = fs.readFileSync(shellConfigFile, 'utf8');

		// Define aliases we want (hamster/ham aliases are managed by Hamster CLI, not TaskGraph)
		const aliases = [
			{ name: 'tm', line: "alias tm='taskgraph'" },
			{ name: 'taskgraph', line: "alias taskgraph='taskgraph'" }
		];

		// Self-healing: remove any stale hamster/ham aliases that point to taskgraph
		const staleAliasPatterns = [
			/alias hamster='taskgraph'\n?/g,
			/alias ham='taskgraph'\n?/g
		];

		let cleanedContent = configContent;
		for (const pattern of staleAliasPatterns) {
			cleanedContent = cleanedContent.replace(pattern, '');
		}
		const removedStale = cleanedContent !== configContent;

		// Clean up empty "TaskGraph aliases" comment blocks left behind
		cleanedContent = cleanedContent.replace(
			/\n# TaskGraph aliases added on [^\n]*\n(?=\s*\n|$)/g,
			'\n'
		);

		if (removedStale) {
			fs.writeFileSync(shellConfigFile, cleanedContent);
			log(
				'debug',
				'Removed stale hamster/ham aliases pointing to taskgraph (these are managed by Hamster CLI)'
			);
		}

		// Check which aliases are missing
		const currentContent = removedStale ? cleanedContent : configContent;
		const missingAliases = aliases.filter(
			(alias) => !currentContent.includes(alias.line)
		);

		if (missingAliases.length === 0) {
			log('debug', 'All TaskGraph aliases already exist.');
			return true;
		}

		// Build alias block with only missing aliases
		const aliasLines = missingAliases.map((a) => a.line).join('\n');
		const aliasBlock = `
# TaskGraph aliases added on ${new Date().toLocaleDateString()}
${aliasLines}
`;

		fs.appendFileSync(shellConfigFile, aliasBlock);
		log(
			'debug',
			`Added ${missingAliases.length} alias(es): ${missingAliases.map((a) => a.name).join(', ')}`
		);

		return true;
	} catch (error) {
		log('debug', `Failed to add aliases: ${error.message}`);
		return false;
	}
}

// Function to create initial state.json file for tag management
function createInitialStateFile(targetDir) {
	const stateFilePath = path.join(targetDir, TASKGRAPH_STATE_FILE);

	// Check if state.json already exists
	if (fs.existsSync(stateFilePath)) {
		log('debug', 'State file already exists, preserving current configuration');
		return;
	}

	// Create initial state configuration
	const initialState = {
		currentTag: 'master',
		lastSwitched: new Date().toISOString(),
		branchTagMapping: {},
		migrationNoticeShown: false
	};

	try {
		fs.writeFileSync(stateFilePath, JSON.stringify(initialState, null, 2));
		log('success', `Created initial state file: ${stateFilePath}`);
		log('info', 'Default tag set to "master" for task organization');
	} catch (error) {
		log('error', `Failed to create state file: ${error.message}`);
	}
}

// Function to copy a file from the package to the target directory
function copyTemplateFile(templateName, targetPath, replacements = {}) {
	// Get the file content from the appropriate source directory
	// Check if the asset exists
	if (!assetExists(templateName)) {
		log('error', `Source file not found: ${templateName}`);
		return;
	}

	// Read the asset content using the resolver
	let content = readAsset(templateName, 'utf8');

	// Replace placeholders with actual values
	Object.entries(replacements).forEach(([key, value]) => {
		const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
		content = content.replace(regex, value);
	});

	// Handle special files that should be merged instead of overwritten
	if (fs.existsSync(targetPath)) {
		const filename = path.basename(targetPath);

		// Handle .gitignore - append lines that don't exist
		if (filename === '.gitignore') {
			log('info', `${targetPath} already exists, merging content...`);
			const existingContent = fs.readFileSync(targetPath, 'utf8');
			const existingLines = new Set(
				existingContent.split('\n').map((line) => line.trim())
			);
			const newLines = content
				.split('\n')
				.filter((line) => !existingLines.has(line.trim()));

			if (newLines.length > 0) {
				// Add a comment to separate the original content from our additions
				const updatedContent = `${existingContent.trim()}\n\n# Added by TaskGraph\n${newLines.join('\n')}`;
				fs.writeFileSync(targetPath, updatedContent);
				log('success', `Updated ${targetPath} with additional entries`);
			} else {
				log('info', `No new content to add to ${targetPath}`);
			}
			return;
		}

		// Handle README.md - offer to preserve or create a different file
		if (filename === 'README-taskgraph.md') {
			log('info', `${targetPath} already exists`);
			// Create a separate README file specifically for this project
			const taskGraphReadmePath = path.join(
				path.dirname(targetPath),
				'README-taskgraph.md'
			);
			fs.writeFileSync(taskGraphReadmePath, content);
			log(
				'success',
				`Created ${taskGraphReadmePath} (preserved original README-taskgraph.md)`
			);
			return;
		}

		// For other files, warn and prompt before overwriting
		log('debug', `${targetPath} already exists, skipping.`);
		return;
	}

	// If the file doesn't exist, create it normally
	fs.writeFileSync(targetPath, content);
	log('info', `Created file: ${targetPath}`);
}

// Main function to initialize a new project
async function initializeProject(options = {}) {
	// Receives options as argument
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

	let selectedRuleProfiles;
	if (options.rulesExplicitlyProvided) {
		// If --rules flag was used, always respect it.
		selectedRuleProfiles = options.rules;
	} else if (skipPrompts) {
		// If non-interactive (e.g., --yes) and no rules specified, skip rules setup entirely
		selectedRuleProfiles = [];
	} else {
		// If interactive and no rules specified, default to NONE.
		// The Claude Code integration prompt below opts in.
		selectedRuleProfiles = [];
	}

	if (skipPrompts) {
		if (!isSilentMode()) {
			console.log('SKIPPING PROMPTS - Using defaults or provided values');
		}

		// Use provided options or defaults
		const projectName = options.name || 'taskgraph-project';
		const projectDescription =
			options.description || 'A project managed with TaskGraph';
		const projectVersion = options.version || '0.1.0';
		const authorName = options.author || 'Vibe coder';
		const dryRun = options.dryRun || false;
		const initGit = options.initGit !== undefined ? options.initGit : true; // Default to true if not specified
		const storeTasksInGit =
			options.storeTasksInGit !== undefined ? options.storeTasksInGit : true; // Default to true if not specified

		if (dryRun) {
			log('info', 'DRY RUN MODE: No files will be modified');
			log('info', 'Would initialize TaskGraph project');
			log('info', 'Would create/update necessary project files');

			// Show flag-specific behavior
			log(
				'info',
				`${initGit ? 'Would initialize Git repository' : 'Would skip Git initialization'}`
			);
			log(
				'info',
				`${storeTasksInGit ? 'Would store tasks in Git' : 'Would exclude tasks from Git'}`
			);

			return {
				dryRun: true
			};
		}

		// Default to local storage in non-interactive mode unless explicitly specified
		const selectedStorage = options.storage || 'local';
		const authCredentials = null; // No auth in non-interactive mode

		await createProjectStructure(
			true, // Always add aliases
			initGit,
			storeTasksInGit,
			dryRun,
			{ ...options, preferredLanguage: 'English' }, // Default to English in non-interactive mode
			selectedRuleProfiles,
			selectedStorage,
			authCredentials
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

			// Prompt for storage selection first
			let selectedStorage = await promptStorageSelection();

			// Track storage_selected event
			// TODO: Send to Segment telemetry when implemented
			log(
				'debug',
				`Storage selected: ${selectedStorage} - taskgraph_id: ${taskgraphId}`
			);

			// If cloud storage selected, trigger OAuth flow
			let authCredentials = null;
			if (selectedStorage === 'cloud') {
				try {
					const authManager = AuthManager.getInstance();

					// Check if already authenticated
					const existingCredentials = await authManager.getAuthCredentials();
					if (existingCredentials) {
						log('success', 'Already authenticated with Hamster');
						authCredentials = existingCredentials;
					} else {
						// Use shared browser auth with MFA support
						// This is the SAME auth flow used by 'tm auth login' and 'tm parse-prd'
						log('info', 'Starting authentication flow...');
						console.log(theme.brand('\n🔐 Authentication Required\n'));
						console.log(
							theme.text(
								'  Selecting cloud storage will open your browser for authentication.'
							)
						);
						console.log(
							theme.muted('  This enables sync across devices with Hamster.\n')
						);

						// Use shared auth utility - handles MFA automatically
						authCredentials = await authenticateWithBrowserMFA(authManager);

						// Track auth_completed event
						log('debug', `Auth completed - taskgraph_id: ${taskgraphId}`);
					}

					// Ensure org is selected (required for all Hamster operations)
					// This runs for both new auth AND existing auth
					// Uses shared utility from @tm/cli
					const orgResult = await ensureOrgSelected(authManager, {
						promptMessage: 'Select an organization to continue:'
					});
					if (!orgResult.success) {
						log('warn', orgResult.message || 'Organization selection required');
					}
				} catch (authError) {
					log(
						'error',
						`Failed to authenticate: ${authError.message}. Falling back to local storage.`
					);
					// Fall back to local storage if auth fails
					selectedStorage = 'local';
				}
			}

			rl = readline.createInterface({
				input: process.stdin,
				output: process.stdout
			});

			// Git-related prompts only make sense for local storage
			// If cloud storage is selected, tasks are stored in Hamster, not Git
			let initGitPrompted = true; // Default to true
			let storeGitPrompted = true; // Default to true

			if (selectedStorage === 'local') {
				// Prompt for Git initialization (skip if --git or --no-git flag was provided)
				if (options.initGit !== undefined) {
					initGitPrompted = options.initGit; // Use flag value if provided
				} else {
					const gitInitInput = await promptQuestion(
						rl,
						chalk.cyan('Initialize a Git repository in project root? (Y/n): '),
						(answer) => {
							const isYes = answer.trim().toLowerCase() !== 'n';
							const icon = isYes ? chalk.green('✓') : chalk.red('✗');
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
							const icon = isYes ? chalk.green('✓') : chalk.red('✗');
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
			} else {
				// Cloud storage: skip Git prompts, but initialize Git repo anyway
				// (users may still want version control for their code)
				initGitPrompted = true;
				// Tasks are in cloud, so don't store them in Git
				storeGitPrompted = false;
			}

			// Prompt for AI IDE rules setup (only if not explicitly provided via --rules)
			let shouldSetupRules = false;
			if (!options.rulesExplicitlyProvided) {
				const setupRulesInput = await promptQuestion(
					rl,
					chalk.cyan(
						'Set up Claude Code integration (CLAUDE.md import)? (y/N): '
					),
					(answer) => {
						const isYes = answer.trim().toLowerCase() === 'y';
						const icon = isYes ? chalk.green('✓') : chalk.red('✗');
						return (
							chalk.cyan('Set up Claude Code integration?') +
							' ' +
							icon +
							' ' +
							chalk.dim(isYes ? 'Yes' : 'No')
						);
					}
				);
				shouldSetupRules = setupRulesInput.trim().toLowerCase() === 'y';
			} else {
				log(
					'info',
					`Using rule profiles provided via command line: ${selectedRuleProfiles.join(', ')}`
				);
			}

			// Prompt for response language preference
			const languageInput = await promptQuestion(
				rl,
				chalk.cyan('Preferred response language (English): ')
			);
			const preferredLanguage = languageInput.trim() || 'English';

			// Confirm settings with cleaner formatting
			console.log('\n' + chalk.bold('TaskGraph Project Settings:'));
			console.log(chalk.dim('─'.repeat(50)));

			// Storage
			console.log(
				'  ' + chalk.dim('Storage:'.padEnd(32)),
				theme.text(
					selectedStorage === 'cloud' ? 'Hamster Studio' : 'Local File Storage'
				)
			);

			// AI IDE rules
			const rulesIcon = shouldSetupRules ? chalk.green('✓') : chalk.dim('✗');
			console.log(
				'  ' + chalk.dim('Claude Code integration:'.padEnd(32)),
				rulesIcon + ' ' + chalk.dim(shouldSetupRules ? 'Yes' : 'No')
			);

			// Response language
			console.log(
				'  ' + chalk.dim('Response language:'.padEnd(32)),
				theme.text(preferredLanguage)
			);

			// Only show Git-related settings for local storage
			if (selectedStorage === 'local') {
				const gitIcon = initGitPrompted ? chalk.green('✓') : chalk.dim('✗');
				console.log(
					'  ' + chalk.dim('Initialize Git repository:'.padEnd(32)),
					gitIcon + ' ' + chalk.dim(initGitPrompted ? 'Yes' : 'No')
				);

				const gitTasksIcon = storeGitPrompted
					? chalk.green('✓')
					: chalk.dim('✗');
				console.log(
					'  ' + chalk.dim('Store tasks in Git:'.padEnd(32)),
					gitTasksIcon + ' ' + chalk.dim(storeGitPrompted ? 'Yes' : 'No')
				);
			}

			console.log(chalk.dim('─'.repeat(50)));

			const confirmInput = await promptQuestion(
				rl,
				chalk.yellow('\nDo you want to continue with these settings? (Y/n): ')
			);
			const shouldContinue = confirmInput.trim().toLowerCase() !== 'n';

			if (!shouldContinue) {
				rl.close();
				log('info', 'Project initialization cancelled by user');
				process.exit(0);
				return;
			}

			const dryRun = options.dryRun || false;

			if (dryRun) {
				log('info', 'DRY RUN MODE: No files will be modified');
				log('info', 'Would initialize TaskGraph project');
				log('info', 'Would create/update necessary project files');

				// Show flag-specific behavior
				log(
					'info',
					`${initGitPrompted ? 'Would initialize Git repository' : 'Would skip Git initialization'}`
				);
				log(
					'info',
					`${storeGitPrompted ? 'Would store tasks in Git' : 'Would exclude tasks from Git'}`
				);

				return {
					dryRun: true
				};
			}

			// Create structure using only necessary values
			// Always add aliases - addShellAliases() handles checking for existing ones
			await createProjectStructure(
				true, // Always add aliases
				initGitPrompted,
				storeGitPrompted,
				dryRun,
				{ ...options, shouldSetupRules, preferredLanguage }, // Pass shouldSetupRules and preferredLanguage through options
				shouldSetupRules ? RULE_PROFILES : selectedRuleProfiles,
				selectedStorage,
				authCredentials
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
 * Update config.json with storage configuration
 * @param {string} configPath - Path to config.json file
 * @param {string} selectedStorage - Storage type ('cloud' or 'local')
 * @param {object|null} authCredentials - Auth credentials if cloud storage selected
 */
function updateStorageConfig(configPath, selectedStorage, authCredentials) {
	try {
		if (!fs.existsSync(configPath)) {
			log('warn', 'Config file does not exist, skipping storage configuration');
			return;
		}

		const configContent = fs.readFileSync(configPath, 'utf8');
		const config = JSON.parse(configContent);

		// Initialize storage config if it doesn't exist
		if (!config.storage) {
			config.storage = {};
		}

		if (selectedStorage === 'cloud') {
			// Configure for API/cloud storage
			config.storage.type = 'api';
			config.storage.apiEndpoint =
				process.env.TM_BASE_DOMAIN ||
				process.env.TM_PUBLIC_BASE_DOMAIN ||
				'https://tryhamster.com/api';

			// Set operating mode to 'team' for cloud storage (Hamster)
			// This determines which slash commands and rules are installed
			config.storage.operatingMode = 'team';

			// Note: Access token is stored in ~/.taskgraph/auth.json by AuthManager
			// We don't store it in config.json for security reasons
			log('debug', 'Connected to Hamster Studio');
		} else {
			// Configure for local file storage
			config.storage.type = 'file';

			// Set operating mode to 'solo' for local storage (TaskGraph standalone)
			// This determines which slash commands and rules are installed
			config.storage.operatingMode = 'solo';

			log('debug', 'Configured storage for local file storage');
		}

		// Write updated config back to file
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		log('debug', 'Storage configuration updated in config.json');
	} catch (error) {
		log('error', `Failed to update storage configuration: ${error.message}`);
	}
}

/**
 * Prompt user to select storage backend (Hamster cloud or local)
 * @returns {Promise<'cloud'|'local'>} Selected storage type
 */
async function promptStorageSelection() {
	if (isSilentMode()) {
		// Default to local in silent mode
		return 'local';
	}

	try {
		// Display header
		console.log(chalk.bold.cyan('You need a plan before you execute.\n'));

		const { storageType } = await inquirer.prompt([
			{
				type: 'list',
				name: 'storageType',
				message: theme.text('How do you want to build it?\n'),
				choices: [
					{
						name: [
							chalk.bold('Solo (TaskGraph)'),
							'',
							theme.text(
								'   • Parse your own PRDs into structured task lists and build with any IDE or background agents'
							),
							theme.text(
								'   • Agents execute tasks with precision, no scope creep, no going off-track'
							),
							theme.text(
								'   • Tasks live in a local JSON file, everything stays in your repo'
							),
							theme.text(
								'   • Upgrade to Hamster to bring the TaskGraph experience to your team'
							),
							''
						].join('\n'),
						value: 'local',
						short: 'Solo (TaskGraph)'
					},

					{
						name: [
							chalk.bold('Together (Hamster)'),
							'',
							theme.text(
								'   • Write a brief with your team. Hamster refines it into a plan.'
							),
							theme.text(
								'   • Your team drafts, refines, and aligns on the same page before executing'
							),
							theme.text(
								'   • One brief, one plan, one source of truth for execution'
							),
							theme.text(
								'   • Access tasks on TaskGraph and execute with any AI agent'
							),
							''
						].join('\n'),
						value: 'cloud',
						short: 'Together (Hamster)'
					}
				],
				default: 'local',
				pageSize: 20 // Increase page size to show both options without scrolling
			}
		]);

		return storageType;
	} catch (error) {
		// Handle Ctrl+C or other interruptions
		if (error.isTtyError || error.name === 'ExitPromptError') {
			log('warn', 'Storage selection cancelled, defaulting to local storage');
			return 'local';
		}
		throw error;
	}
}

// Function to create the project structure
async function createProjectStructure(
	addAliases,
	initGit,
	storeTasksInGit,
	dryRun,
	options,
	selectedRuleProfiles = RULE_PROFILES,
	selectedStorage = 'local',
	authCredentials = null
) {
	const targetDir = process.cwd();
	log('debug', `Initializing project in ${targetDir}`);

	// Create NEW .taskgraph directory structure (using constants)
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_TASKS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_DOCS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_REPORTS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_TEMPLATES_DIR));

	// Create initial state.json file for tag management
	createInitialStateFile(targetDir);

	// Copy template files with replacements
	const replacements = {
		year: new Date().getFullYear()
	};

	// Helper function to create rule profiles
	// Derives operating mode from storage selection:
	// - 'cloud' (Hamster) -> 'team' mode
	// - 'local' (TaskGraph standalone) -> 'solo' mode
	const operatingMode = selectedStorage === 'cloud' ? 'team' : 'solo';

	function _processSingleProfile(profileName) {
		const profile = getRulesProfile(profileName);
		if (profile) {
			// Pass operating mode to filter rules and slash commands
			convertAllRulesToProfileRules(targetDir, profile, {
				mode: operatingMode
			});
			// Also triggers MCP config setup (if applicable)
		} else {
			log('warn', `Unknown rule profile: ${profileName}`);
		}
	}

	// Copy .env.example
	copyTemplateFile(
		'env.example',
		path.join(targetDir, ENV_EXAMPLE_FILE),
		replacements
	);

	// Copy config.json with project name to NEW location
	copyTemplateFile('config.json', path.join(targetDir, TASKGRAPH_CONFIG_FILE), {
		...replacements
	});

	// Update config.json with correct maxTokens values from supported-models.json
	const configPath = path.join(targetDir, TASKGRAPH_CONFIG_FILE);
	if (updateConfigMaxTokens(configPath)) {
		log('debug', 'Updated config with correct maxTokens values');
	} else {
		log('debug', 'Could not update maxTokens in config');
	}

	// Update config.json with storage configuration
	updateStorageConfig(configPath, selectedStorage, authCredentials);

	// Copy .gitignore with GitTasks preference
	try {
		const templateContent = readAsset('gitignore', 'utf8');
		manageGitignoreFile(
			path.join(targetDir, GITIGNORE_FILE),
			templateContent,
			storeTasksInGit,
			log
		);
	} catch (error) {
		log('error', `Failed to create .gitignore: ${error.message}`);
	}

	// Copy example_prd.txt to NEW location
	copyTemplateFile('example_prd.txt', path.join(targetDir, EXAMPLE_PRD_FILE));

	// Copy example_prd_rpg.txt to templates directory
	copyTemplateFile(
		'example_prd_rpg.txt',
		path.join(targetDir, TASKGRAPH_TEMPLATES_DIR, 'example_prd_rpg.txt')
	);

	// Initialize git repository if git is available
	try {
		if (initGit === false) {
			log('info', 'Git initialization skipped due to --no-git flag.');
		} else if (initGit === true) {
			if (insideGitWorkTree()) {
				log(
					'debug',
					'Existing Git repository detected – skipping git init despite --git flag.'
				);
			} else {
				log('info', 'Initializing Git repository due to --git flag...');
				execSync('git init', { cwd: targetDir, stdio: 'ignore' });
				log('success', 'Git repository initialized');
			}
		} else {
			// Default behavior when no flag is provided (from interactive prompt)
			if (insideGitWorkTree()) {
				log('debug', 'Existing Git repository detected – skipping git init.');
			} else {
				log(
					'info',
					'No Git repository detected. Initializing one in project root...'
				);
				execSync('git init', { cwd: targetDir, stdio: 'ignore' });
				log('success', 'Git repository initialized');
			}
		}
	} catch (error) {
		log('warn', 'Git not available, skipping repository initialization');
	}

	// Install the Claude profile if requested via --rules or the interactive prompt.
	if (selectedRuleProfiles.length > 0) {
		log('info', 'Setting up Claude Code integration...');
		for (const profileName of selectedRuleProfiles) {
			_processSingleProfile(profileName);
		}
	}

	// Add shell aliases if requested
	if (addAliases) {
		addShellAliases();
	}

	// Run npm install automatically
	const npmInstallOptions = {
		cwd: targetDir,
		// Default to inherit for interactive CLI, change if silent
		stdio: 'inherit'
	};

	if (isSilentMode()) {
		// If silent (MCP mode), suppress npm install output
		npmInstallOptions.stdio = 'ignore';
		log('info', 'Running npm install silently...'); // Log our own message
	}

	// === Add Response Language Step ===
	// Set language directly if provided via interactive prompt
	if (options.preferredLanguage && !dryRun) {
		try {
			const responseLanguageModule = await import(
				'./modules/task-manager/response-language.js'
			);
			const setResponseLanguage = responseLanguageModule.default;
			setResponseLanguage(options.preferredLanguage, {
				projectRoot: targetDir,
				silent: true
			});
			log('debug', `Response language set to: ${options.preferredLanguage}`);
		} catch (error) {
			log('warn', `Failed to set response language: ${error.message}`);
		}
	} else if (isSilentMode() && !dryRun) {
		log('debug', 'Skipping response language setup in silent (MCP) mode.');
	} else if (dryRun) {
		log('debug', 'DRY RUN: Skipping response language setup.');
	}
	// =====================================

	// === Add Model Configuration Step ===
	// Only configure models for local storage (need API keys for direct AI usage)
	// Cloud storage (Hamster) manages AI models on the backend - no API keys or extra costs needed
	if (
		!isSilentMode() &&
		!dryRun &&
		!options?.yes &&
		selectedStorage === 'local'
	) {
		console.log(
			boxen(chalk.cyan('Configuring AI Models...'), {
				padding: 0.5,
				margin: { top: 1, bottom: 0.5 },
				borderStyle: 'round',
				borderColor: 'cyan',
				width: BOX_WIDTH
			})
		);
		log(
			'info',
			'Running interactive model setup. Please select your preferred AI models.'
		);
		try {
			execSync('npx taskgraph models --setup', {
				stdio: 'inherit',
				cwd: targetDir
			});
			log('success', 'AI Models configured.');
		} catch (error) {
			log('error', 'Failed to configure AI models:', error.message);
			log('warn', 'You may need to run "taskgraph models --setup" manually.');
		}
	} else if (selectedStorage === 'cloud' && !dryRun) {
		console.log(
			boxen(
				chalk.green.bold('✓ AI Models Managed by Hamster - go ham!\n\n') +
					theme.text('Hamster handles all AI model configuration for you.\n') +
					chalk.dim('• Optimized model selection for your tasks\n') +
					chalk.dim('• No API keys required\n') +
					chalk.dim('• No extra costs'),
				{
					padding: 1,
					margin: { top: 1, bottom: 0.5 },
					borderStyle: 'round',
					borderColor: 'cyan',
					width: BOX_WIDTH
				}
			)
		);
	} else if (isSilentMode() && !dryRun) {
		log('info', 'Skipping interactive model setup in silent (MCP) mode.');
		log(
			'warn',
			'Please configure AI models using "taskgraph models --set-..." or the "models" MCP tool.'
		);
	} else if (dryRun) {
		log('info', 'DRY RUN: Skipping interactive model setup.');
	} else if (options?.yes) {
		log('info', 'Skipping interactive model setup due to --yes flag.');
		log(
			'info',
			'Default AI models will be used. You can configure different models later using "taskgraph models --setup" or "taskgraph models --set-..." commands.'
		);
	}
	// ====================================

	// Add shell aliases if requested
	if (addAliases && !dryRun) {
		log('debug', 'Adding shell aliases...');
		const aliasResult = addShellAliases();
		if (aliasResult) {
			log('debug', 'Shell aliases added successfully');
		}
	} else if (addAliases && dryRun) {
		log('debug', 'DRY RUN: Would add shell aliases (tm, taskgraph)');
	}

	// Display success message
	if (!isSilentMode()) {
		// Show elegant welcome message for Hamster, regular success for local
		if (selectedStorage === 'cloud') {
			// High-fidelity hamster pixel art (displayed without box)
			const hamsterArt = readAsset('hamster-art.txt', 'utf8');
			console.log('\n' + chalk.cyan(hamsterArt));
			console.log('');

			// Box with connection message and next steps
			const welcomeMessage = [
				chalk.green.bold('✓ Connected to Hamster Studio'),
				'',
				theme.text("Your team's workspace is ready to go ham!\n"),
				chalk.dim('Draft together. Align once. Build with agents.'),
				'',
				chalk.cyan('How to orchestrate with TaskGraph:'),
				theme.text('  • Create your first brief at: ') +
					chalk.underline.cyan('https://tryhamster.com'),
				theme.text('  • Connect your brief using ') +
					chalk.bold('tm context <brief-url>') +
					theme.text(' to access tasks in TaskGraph'),
				theme.text('  • Orchestrate and implement tasks using ') +
					chalk.bold('tm next') +
					theme.text(' to kickoff any AI agent'),
				theme.text('  • Run ') +
					chalk.bold('tm help') +
					theme.text(' to explore other available commands')
			].join('\n');

			console.log(
				boxen(welcomeMessage, {
					padding: 1,
					margin: { top: 1, bottom: 0, left: 0, right: 0 },
					borderStyle: 'round',
					borderColor: 'cyan',
					width: BOX_WIDTH
				})
			);
		} else {
			console.log(
				boxen(
					`${brandGradient.multiline(
						figlet.textSync('Success!', { font: 'Standard' })
					)}\n${chalk.green('Project initialized successfully!')}`,
					{
						padding: 1,
						margin: 1,
						borderStyle: 'double',
						borderColor: 'green',
						width: BOX_WIDTH
					}
				)
			);
		}
	}

	// Display next steps in a nice box
	if (!isSilentMode()) {
		// Different Getting Started for Hamster vs Local
		let gettingStartedMessage;

		if (selectedStorage === 'cloud') {
			// Hamster-specific workflow
			gettingStartedMessage = `${chalk.cyan.bold("Here's how to execute your Hamster briefs with TaskGraph")}\n\n${theme.text('1. ')}${chalk.yellow(
				'Create your first brief at'
			)} ${chalk.cyan.underline('https://tryhamster.com')}\n${theme.text('   └─ ')}${chalk.dim('Hamster will write your brief and generate the full task plan')}\n${theme.text('2. ')}${chalk.yellow(
				'Set up Claude Code integration'
			)}\n${theme.text('   └─ ')}${chalk.dim('CLI: ')}${chalk.cyan('taskgraph init --rules claude')}${chalk.dim(' - Adds CLAUDE.md import and MCP config')}\n${theme.text('3. ')}${chalk.yellow(
				'Connect your brief to TaskGraph'
			)}\n${theme.text('   └─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm context <brief-url> OR tm briefs')}\n${theme.text('4. ')}${chalk.yellow(
				'View your tasks from the brief'
			)}\n${theme.text('   └─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm list')}${chalk.dim(' or ')}${chalk.cyan('tm list all')}${chalk.dim(' (with subtasks)')}\n${theme.text('5. ')}${chalk.yellow(
				'Work on tasks with any AI coding assistant or background agent'
			)}\n${theme.text('   ├─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm next')}${chalk.dim(' - Find the next task to work on')}\n${theme.text('   ├─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm show <id>')}${chalk.dim(' - View task details')}\n${theme.text('   ├─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm status <id> in-progress')}${chalk.dim(' - Mark task started')}\n${theme.text('   └─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm status <id> done')}${chalk.dim(' - Mark task complete')}\n${theme.text('6. ')}${chalk.yellow(
				'Add notes or updates to tasks'
			)}\n${theme.text('   └─ ')}${chalk.dim('CLI: ')}${chalk.cyan('tm update-task <id> <notes>')}\n${theme.text('7. ')}${chalk.green.bold('Ship it!')}\n\n${chalk.dim(
				'* Run '
			)}${chalk.cyan('tm help')}${chalk.dim(' to see all available commands')}`;
		} else {
			// Local-specific getting started
			gettingStartedMessage = getLocalGettingStartedMessage();
		}

		console.log(
			boxen(chalk.yellow.bold('Workflow\n') + '\n' + gettingStartedMessage, {
				padding: 1,
				margin: { top: 0, bottom: 1, left: 0, right: 0 },
				borderStyle: 'round',
				borderColor: 'yellow',
				width: BOX_WIDTH
			})
		);
	}
}

// Ensure necessary functions are exported
export { initializeProject, log };
