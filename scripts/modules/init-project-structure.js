/** init's writes: the .taskgraph/ tree, Git, Claude Code files and the summary */
import { execSync } from 'child_process';
import path from 'path';
import { ui } from '@tm/cli';
import {
	findOnPath,
	installMergeDriver,
	mergeDriverCommand,
	setResponseLanguage
} from '@tm/core';
import {
	ENV_EXAMPLE_FILE,
	EXAMPLE_PRD_FILE,
	GITIGNORE_FILE,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_DIR,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_REPORTS_DIR,
	TASKGRAPH_STATE_FILE,
	TASKGRAPH_TASKS_DIR,
	TASKGRAPH_TEMPLATES_DIR
} from '../../src/constants/paths.js';
import { RULE_PROFILES } from '../../src/constants/profiles.js';
import { readAsset } from '../../src/utils/asset-resolver.js';
import { manageGitignoreFile } from '../../src/utils/manage-gitignore.js';
import {
	convertAllRulesToProfileRules,
	getRulesProfile
} from '../../src/utils/rule-transformer.js';
import { moveMachineSettings } from './config-manager.js';
import {
	describeInitChanges,
	isTrackedInGit,
	snapshotPaths,
	trackedPaths
} from './init-changes.js';
import { log, quietLog } from './init-log.js';
import {
	copyTemplateFile,
	createInitialStateFile,
	createInitialTasksFile,
	ensureDirectoryExists,
	updateStorageConfig
} from './init-project-files.js';
import { addShellAliases } from './init-shell-aliases.js';
import * as upstream from './init-upstream-import.js';
import { updateConfigMaxTokens } from './update-config-tokens.js';
import { isSilentMode } from './utils.js';
import { insideGitWorkTree } from './utils/git-utils.js';

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
			// .mcp.json only with --mcp: the CLI and the plugin need no MCP server
			convertAllRulesToProfileRules(targetDir, profile, {
				mcp: options.mcp === true
			});
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

	// Move per-machine settings an earlier release kept in the shared
	// config.json to the gitignored config.local.json
	const movedMachineSettings = moveMachineSettings(targetDir);

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

	// Let Git merge tasks.json by task, so two branches that both add a task
	// don't conflict (#210). Pointless when tasks.json isn't committed.
	if (storeTasksInGit && insideGitWorkTree()) {
		try {
			setUpMergeDriver(targetDir);
		} catch (error) {
			log(
				'warn',
				`Couldn't set up the tasks.json merge driver: ${error.message}`
			);
		}
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
			const result = setResponseLanguage(targetDir, options.preferredLanguage);
			if (!result.success) throw new Error(result.error.message);
			log('debug', `Response language set to: ${options.preferredLanguage}`);
		} catch (error) {
			log('warn', `Failed to set response language: ${error.message}`);
		}
	}
	// =====================================

	const imported = upstream.runUpstreamImport(targetDir, options, dryRun);

	// === Add Model Configuration Step ===
	// Interactive runs choose models now; --yes keeps the defaults, which the
	// summary mentions. An import brings its models. MCP clients set models
	// with the `models` tool.
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

	if (!isSilentMode()) {
		const { alreadySetUp, changes } = describeInitChanges(
			targetDir,
			before,
			snapshotPaths(watched)
		);
		// Listed whether config.local.json is new or already had settings.
		// A move needs an existing config.json, so this is the first row.
		if (movedMachineSettings) {
			changes.unshift({
				path: TASKGRAPH_LOCAL_CONFIG_FILE,
				note: "this machine's settings, moved from config.json"
			});
		}
		// .gitignore doesn't untrack a state.json an earlier init let in
		const hints = isTrackedInGit(targetDir, TASKGRAPH_STATE_FILE)
			? [
					{
						path: TASKGRAPH_STATE_FILE,
						note: 'ignored but still tracked; `git rm --cached` it'
					}
				]
			: [];
		if (imported) {
			upstream.printUpstreamImportSummary(
				imported,
				[...changes, ...hints],
				TASKGRAPH_DIR
			);
			return;
		}
		console.log(
			`${ui.formatInitSummary({
				folder: path.basename(targetDir),
				changes,
				hints,
				alreadySetUp,
				claudeCode: selectedRuleProfiles.includes('claude'),
				defaultModels: Boolean(options?.yes)
			})}\n`
		);
	}
}

/**
 * Set up the Git merge driver for tasks.json in `targetDir`: the
 * .gitattributes line and this clone's git config. Git runs `taskgraph`
 * when it's on PATH, otherwise this CLI by its path.
 * @returns {{attributes: string, config: string}} What changed
 * @throws {NotAGitRepositoryError} Outside a Git work tree
 */
function setUpMergeDriver(targetDir) {
	const command = mergeDriverCommand({
		onPath: findOnPath('taskgraph') !== null,
		execPath: process.execPath,
		scriptPath: path.resolve(process.argv[1])
	});
	return installMergeDriver(targetDir, command);
}

export { createProjectStructure, setUpMergeDriver };
