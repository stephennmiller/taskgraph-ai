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
import { printError, ui } from '@tm/cli';
import {
	TaskMasterImportError,
	checkTaskMasterImport,
	importTaskMasterProject
} from '@tm/core';
import chalk from 'chalk';
import { RULE_PROFILES } from '../src/constants/profiles.js';
import {
	manageGitignoreFile,
	readStoreTasksInGit
} from '../src/utils/manage-gitignore.js';
import {
	convertAllRulesToProfileRules,
	getRulesProfile
} from '../src/utils/rule-transformer.js';
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
	TASKGRAPH_TASKS_FILE,
	TASKGRAPH_TEMPLATES_DIR
} from '../src/constants/paths.js';

// The alias init adds to the shell config
const ALIAS_LINE = "alias tm='taskgraph'";

// What @tm/profiles writes to turn on deferred MCP loading
const DEFERRED_MCP_MARKER = 'ENABLE_EXPERIMENTAL_MCP_CLI';

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

// Steps report at debug level; the summary at the end says what changed.
// Warnings and errors still print as they happen.
function quietLog(level, ...args) {
	log(level === 'warn' || level === 'error' ? level : 'debug', ...args);
}

// Function to create directory if it doesn't exist
function ensureDirectoryExists(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
		log('debug', `Created directory: ${dirPath}`);
	}
}

/**
 * Shell startup files init may append to (the `tm` alias, deferred MCP
 * loading), so the summary can say which one changed.
 */
function shellConfigFiles() {
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	if (!homeDir) return [];
	return ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map((name) =>
		path.join(homeDir, name)
	);
}

/** Paths whose before/after state the init summary compares */
function trackedPaths(targetDir) {
	return [
		path.join(targetDir, TASKGRAPH_DIR),
		path.join(targetDir, TASKGRAPH_CONFIG_FILE),
		path.join(targetDir, TASKGRAPH_TASKS_FILE),
		path.join(targetDir, '.git'),
		path.join(targetDir, GITIGNORE_FILE),
		path.join(targetDir, ENV_EXAMPLE_FILE),
		path.join(targetDir, 'CLAUDE.md'),
		path.join(targetDir, '.mcp.json'),
		...shellConfigFiles()
	];
}

/**
 * Record whether each path exists and, for files, its content.
 * @returns {Map<string, string|null>} null = missing, '' for directories
 */
function snapshotPaths(paths) {
	const snapshot = new Map();
	for (const filePath of paths) {
		let state = null;
		try {
			if (fs.existsSync(filePath)) {
				state = fs.statSync(filePath).isDirectory()
					? ''
					: fs.readFileSync(filePath, 'utf8');
			}
		} catch {
			state = null;
		}
		snapshot.set(filePath, state);
	}
	return snapshot;
}

/**
 * Turn before/after snapshots into the summary's list of changes.
 * @returns {{alreadySetUp: boolean, changes: Array<{path: string, note: string}>}}
 */
function describeInitChanges(targetDir, before, after) {
	const at = (relative) => path.join(targetDir, relative);
	const created = (file) => before.get(file) == null && after.get(file) != null;
	const changed = (file) =>
		before.get(file) != null &&
		after.get(file) != null &&
		before.get(file) !== after.get(file);

	const alreadySetUp =
		before.get(at(TASKGRAPH_CONFIG_FILE)) != null ||
		before.get(at(TASKGRAPH_TASKS_FILE)) != null;
	const changes = [];

	if (!alreadySetUp && after.get(at(TASKGRAPH_CONFIG_FILE)) != null) {
		changes.push({
			path: `${TASKGRAPH_DIR}/`,
			note: 'tasks, settings and PRD templates'
		});
	} else if (alreadySetUp && created(at(TASKGRAPH_CONFIG_FILE))) {
		changes.push({ path: TASKGRAPH_CONFIG_FILE, note: 'restored' });
	}

	if (created(at('.git'))) {
		changes.push({ path: '.git/', note: 'new Git repository' });
	}

	const projectFiles = [
		[GITIGNORE_FILE, 'created', 'added TaskGraph entries'],
		[ENV_EXAMPLE_FILE, 'optional settings', 'updated'],
		[
			'CLAUDE.md',
			"loads TaskGraph's instructions in Claude Code",
			"now imports TaskGraph's instructions"
		],
		[
			'.mcp.json',
			'TaskGraph MCP server for Claude Code',
			'added the TaskGraph MCP server'
		]
	];
	for (const [relative, createdNote, changedNote] of projectFiles) {
		const file = at(relative);
		if (created(file)) changes.push({ path: relative, note: createdNote });
		else if (changed(file)) changes.push({ path: relative, note: changedNote });
	}

	const homeDir = process.env.HOME || process.env.USERPROFILE;
	for (const file of shellConfigFiles()) {
		const was = before.get(file) || '';
		const now = after.get(file) || '';
		if (now === was) continue;
		const added = [];
		if (now.includes(ALIAS_LINE) && !was.includes(ALIAS_LINE)) {
			added.push('the `tm` alias');
		}
		if (
			now.includes(DEFERRED_MCP_MARKER) &&
			!was.includes(DEFERRED_MCP_MARKER)
		) {
			added.push('deferred MCP loading');
		}
		if (added.length === 0) continue;
		changes.push({
			path: homeDir ? file.replace(homeDir, '~') : file,
			note: `added ${added.join(' and ')}; open a new terminal`
		});
	}

	return { alreadySetUp, changes };
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

		// `taskgraph` is already the command name, so `tm` is the only alias
		const aliases = [{ name: 'tm', line: ALIAS_LINE }];

		// Check which aliases are missing
		const missingAliases = aliases.filter(
			(alias) => !configContent.includes(alias.line)
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

	// Create initial state configuration. A new project has nothing to migrate,
	// so the "TaskGraph now supports tags" notice for upgraded projects is
	// marked as shown
	const initialState = {
		currentTag: 'master',
		lastSwitched: new Date().toISOString(),
		branchTagMapping: {},
		migrationNoticeShown: true
	};

	try {
		fs.writeFileSync(stateFilePath, JSON.stringify(initialState, null, 2));
		log('debug', `Created initial state file: ${stateFilePath}`);
	} catch (error) {
		log('error', `Failed to create state file: ${error.message}`);
	}
}

/**
 * Create an empty tasks.json, so adding the first task by hand, listing tags
 * and every other command work before parse-prd has run. An existing file is
 * left alone.
 */
function createInitialTasksFile(targetDir) {
	const tasksPath = path.join(targetDir, TASKGRAPH_TASKS_FILE);
	if (fs.existsSync(tasksPath)) return;

	const emptyTasks = {
		master: {
			tasks: [],
			metadata: {
				created: new Date().toISOString(),
				description: 'Tasks for master context'
			}
		}
	};
	try {
		fs.writeFileSync(tasksPath, `${JSON.stringify(emptyTasks, null, 2)}\n`);
		log('debug', `Created empty tasks file: ${tasksPath}`);
	} catch (error) {
		log('error', `Failed to create tasks file: ${error.message}`);
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
			log('debug', `${targetPath} already exists, merging content...`);
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
				log('debug', `Updated ${targetPath} with additional entries`);
			} else {
				log('debug', `No new content to add to ${targetPath}`);
			}
			return;
		}

		// Handle README.md - offer to preserve or create a different file
		if (filename === 'README-taskgraph.md') {
			log('debug', `${targetPath} already exists`);
			// Create a separate README file specifically for this project
			const taskGraphReadmePath = path.join(
				path.dirname(targetPath),
				'README-taskgraph.md'
			);
			fs.writeFileSync(taskGraphReadmePath, content);
			log(
				'debug',
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
	log('debug', `Created file: ${targetPath}`);
}

// Main function to initialize a new project
async function initializeProject(options = {}) {
	// Receives options as argument
	// Check an import can run before the banner, prompts or any write
	if (options.fromTaskmaster) {
		try {
			checkTaskMasterImport(process.cwd());
		} catch (error) {
			if (!(error instanceof TaskMasterImportError)) throw error;
			if (isSilentMode()) throw error;
			printError(error.message, error.hint);
			process.exit(1);
		}
	}

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
			displayDryRun(initGit, storeTasksInGit, options.fromTaskmaster);
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
				shouldSetupRules = setupRulesInput.trim().toLowerCase() === 'y';
			} else {
				log(
					'debug',
					`Using rule profiles provided via command line: ${selectedRuleProfiles.join(', ')}`
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
					options.fromTaskmaster
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
				shouldSetupRules ? RULE_PROFILES : selectedRuleProfiles
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
 * Update config.json with the local file storage configuration
 * @param {string} configPath - Path to config.json file
 */
function updateStorageConfig(configPath) {
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

		config.storage.type = 'file';

		// 'solo' selects the standalone slash commands and rules
		config.storage.operatingMode = 'solo';

		log('debug', 'Configured storage for local file storage');

		// Write updated config back to file
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		log('debug', 'Storage configuration updated in config.json');
	} catch (error) {
		log('error', `Failed to update storage configuration: ${error.message}`);
	}
}

// Function to create the project structure
async function createProjectStructure(
	addAliases,
	initGit,
	storeTasksInGit,
	dryRun,
	options,
	selectedRuleProfiles = RULE_PROFILES
) {
	const targetDir = process.cwd();
	log('debug', `Initializing project in ${targetDir}`);

	// What exists before init touches anything, for the summary at the end
	const watched = isSilentMode() ? [] : trackedPaths(targetDir);
	const before = snapshotPaths(watched);

	// Create NEW .taskgraph directory structure (using constants)
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_TASKS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_DOCS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_REPORTS_DIR));
	ensureDirectoryExists(path.join(targetDir, TASKGRAPH_TEMPLATES_DIR));

	// Create initial state.json file for tag management
	createInitialStateFile(targetDir);
	createInitialTasksFile(targetDir);

	// Copy template files with replacements
	const replacements = {
		year: new Date().getFullYear()
	};

	// Helper function to create rule profiles
	function _processSingleProfile(profileName) {
		const profile = getRulesProfile(profileName);
		if (profile) {
			convertAllRulesToProfileRules(targetDir, profile);
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
	updateStorageConfig(configPath);

	// Copy .gitignore with GitTasks preference
	try {
		const templateContent = readAsset('gitignore', 'utf8');
		manageGitignoreFile(
			path.join(targetDir, GITIGNORE_FILE),
			templateContent,
			storeTasksInGit,
			quietLog
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

	// Initialize a git repository unless --no-git or there already is one
	try {
		if (initGit === false) {
			log('debug', 'Git initialization skipped due to --no-git flag.');
		} else if (insideGitWorkTree()) {
			log('debug', 'Existing Git repository detected; skipping git init.');
		} else {
			execSync('git init', { cwd: targetDir, stdio: 'ignore' });
			log('debug', 'Git repository initialized');
		}
	} catch (error) {
		log('warn', 'Git not available, skipping repository initialization');
	}

	// Install the Claude profile if requested via --rules or the interactive prompt.
	if (selectedRuleProfiles.length > 0) {
		log('debug', 'Setting up Claude Code integration...');
		for (const profileName of selectedRuleProfiles) {
			_processSingleProfile(profileName);
		}
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
	}
	// =====================================

	// Bring in a Task Master project: its tasks, docs, reports and the
	// settings that still apply, including its response language and models
	const imported =
		options.fromTaskmaster && !dryRun
			? importTaskMasterProject(targetDir)
			: undefined;

	// === Add Model Configuration Step ===
	// Interactive runs choose models now; --yes keeps the defaults, which the
	// summary mentions. An import brings its models along. MCP clients set
	// models with the `models` tool.
	if (!isSilentMode() && !dryRun && !options?.yes && !imported) {
		console.log('');
		try {
			// Run this same CLI rather than `npx taskgraph`, which can resolve
			// to a different npm package when TaskGraph isn't installed locally
			execSync(
				`"${process.execPath}" "${process.argv[1]}" models --setup --no-banner`,
				{ stdio: 'inherit', cwd: targetDir }
			);
			console.log('');
		} catch (error) {
			log(
				'warn',
				'Model setup did not finish; run `taskgraph models --setup` to retry'
			);
		}
	} else if (isSilentMode() && !dryRun) {
		log('debug', 'Skipping interactive model setup in silent (MCP) mode.');
	}
	// ====================================

	if (addAliases && !dryRun) {
		addShellAliases();
	}

	if (!isSilentMode() && imported) {
		const { changes } = describeInitChanges(
			targetDir,
			before,
			snapshotPaths(watched)
		);
		console.log(
			`${ui.formatTaskMasterImport({
				result: imported,
				changes: changes.filter((change) => change.path !== `${TASKGRAPH_DIR}/`)
			})}\n`
		);
	} else if (!isSilentMode()) {
		const { alreadySetUp, changes } = describeInitChanges(
			targetDir,
			before,
			snapshotPaths(watched)
		);
		console.log(
			`${ui.formatInitSummary({
				folder: path.basename(targetDir),
				changes,
				alreadySetUp,
				claudeCode: selectedRuleProfiles.includes('claude'),
				defaultModels: Boolean(options?.yes)
			})}\n`
		);
	}
}

/**
 * Say what init would do without doing it.
 * @param {boolean} initGit - Whether git init would run
 * @param {boolean} storeTasksInGit - Whether tasks would be committed
 * @param {boolean} [fromTaskmaster] - Whether .taskmaster/ would be imported
 */
function displayDryRun(initGit, storeTasksInGit, fromTaskmaster) {
	if (isSilentMode()) return;
	const lines = [
		'Dry run; nothing was changed. Init would:',
		`  create ${TASKGRAPH_DIR}/ with tasks, settings and PRD templates`,
		...(fromTaskmaster
			? ['  import tasks, docs, reports and settings from .taskmaster/']
			: []),
		`  create or update ${GITIGNORE_FILE} and ${ENV_EXAMPLE_FILE}`
	];
	if (initGit !== false && !insideGitWorkTree()) {
		lines.push('  start a Git repository');
	}
	lines.push(
		storeTasksInGit ? '  keep tasks in Git' : '  keep tasks out of Git'
	);
	console.log(lines.join('\n'));
}

// Ensure necessary functions are exported
export { initializeProject, log };
