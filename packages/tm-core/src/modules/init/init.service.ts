/**
 * @fileoverview `taskgraph init` and the MCP `initialize_project` tool: set up
 * .taskgraph/ (tasks, settings, templates), .gitignore and .env.example, Git
 * and the tasks.json merge driver, the Claude Code integration, the response
 * language, the `tm` alias and the import from the upstream project.
 * Re-running it keeps every file the user already has. It prints nothing:
 * the caller shows the result.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
} from '../../common/constants/paths.js';
import { getLogger } from '../../common/logger/index.js';
import { setResponseLanguage } from '../config/services/project-settings.js';
import {
	findOnPath,
	installMergeDriver,
	isInsideGitWorkTree,
	type MergeDriverInstallResult,
	mergeDriverCommand
} from '../git/merge-driver/merge-driver-files.js';
import {
	type UpstreamImportResult,
	importUpstreamProject
} from '../migration/upstream-import.js';
import { readAsset } from './assets.js';
import { type InitReport, setUpClaudeCode } from './claude-code.js';
import { manageGitignoreFile, readStoreTasksInGit } from './gitignore.js';
import {
	type InitChange,
	describeInitChanges,
	isTrackedInGit,
	snapshotPaths,
	trackedPaths
} from './init-changes.js';
import {
	copyTemplateFile,
	createInitialStateFile,
	createInitialTasksFile,
	moveMachineSettings,
	updateConfigMaxTokens,
	updateStorageConfig
} from './project-files.js';
import { addShellAliases, aliasMissingFile } from './shell-aliases.js';

export interface InitProjectOptions {
	/** The folder to set up */
	projectRoot: string;
	/** Run `git init` when the folder isn't in a repository (default true) */
	initGit?: boolean;
	/**
	 * Commit tasks.json (default: what an earlier init chose in .gitignore,
	 * else true)
	 */
	storeTasksInGit?: boolean;
	/** Set up Claude Code's CLAUDE.md import */
	claudeCode: boolean;
	/** Also register the MCP server in .mcp.json (needs claudeCode) */
	mcp?: boolean;
	/** Add the `tm` alias to the shell startup file */
	aliases?: boolean;
	/** Written to config.json's global.responseLanguage */
	responseLanguage?: string;
	/** Import the upstream project's folder after setting up */
	importUpstream?: boolean;
}

/** A step that failed without stopping init, to show as it ended */
export interface InitProblem {
	level: 'warn' | 'error';
	message: string;
}

export interface InitProjectResult {
	/** The folder was a TaskGraph project before this run */
	alreadySetUp: boolean;
	/** Files and folders created or changed, for the summary */
	changes: InitChange[];
	/** Files init left alone that the user should act on */
	hints: InitChange[];
	/** What the upstream import brought, when it ran */
	imported?: UpstreamImportResult;
	problems: InitProblem[];
}

/** What init would do, for `--dry-run` */
export interface InitPlan {
	/** `git init` would run */
	startGit: boolean;
	/** The tasks.json merge driver would be set up */
	mergeDriver: boolean;
	/** The shell startup file the `tm` alias would go in, if any */
	aliasFile: string | null;
}

/** Commit tasks.json: the choice given, else an earlier init's, else yes */
export function resolveStoreTasksInGit(
	projectRoot: string,
	storeTasksInGit?: boolean
): boolean {
	return (
		storeTasksInGit ??
		readStoreTasksInGit(path.join(projectRoot, GITIGNORE_FILE)) ??
		true
	);
}

/** What {@link initializeProject} would change, without changing it */
export function planInit(
	projectRoot: string,
	options: { initGit: boolean; storeTasksInGit: boolean; aliases: boolean }
): InitPlan {
	const inRepo = isInsideGitWorkTree(projectRoot);
	return {
		startGit: options.initGit && !inRepo,
		mergeDriver: options.storeTasksInGit && (options.initGit || inRepo),
		aliasFile: options.aliases ? aliasMissingFile() : null
	};
}

/**
 * Set up the Git merge driver for tasks.json in `targetDir`: the
 * .gitattributes line and this clone's git config. Git runs `taskgraph`
 * when it's on PATH, otherwise this process's script by its path.
 * @throws {NotAGitRepositoryError} Outside a Git work tree
 */
export function setUpMergeDriver(
	targetDir: string,
	scriptPath = path.resolve(process.argv[1] ?? '')
): MergeDriverInstallResult {
	const command = mergeDriverCommand({
		onPath: findOnPath('taskgraph') !== null,
		execPath: process.execPath,
		scriptPath
	});
	return installMergeDriver(targetDir, command);
}

/**
 * Set up TaskGraph in `options.projectRoot`
 * @throws {UpstreamImportError} When the upstream import can't run
 */
export function initializeProject(
	options: InitProjectOptions
): InitProjectResult {
	const targetDir = options.projectRoot;
	const log = getLogger('Init');
	const problems: InitProblem[] = [];
	const report: InitReport = (level, message) =>
		problems.push({ level, message });
	const initGit = options.initGit ?? true;
	const storeTasksInGit = resolveStoreTasksInGit(
		targetDir,
		options.storeTasksInGit
	);
	log.debug(`Initializing project in ${targetDir}`);

	// What exists before init touches anything, for the summary at the end
	const watched = trackedPaths(targetDir);
	const before = snapshotPaths(watched);

	for (const dir of [
		TASKGRAPH_DIR,
		TASKGRAPH_TASKS_DIR,
		TASKGRAPH_DOCS_DIR,
		TASKGRAPH_REPORTS_DIR,
		TASKGRAPH_TEMPLATES_DIR
	]) {
		fs.mkdirSync(path.join(targetDir, dir), { recursive: true });
	}
	createInitialStateFile(targetDir, report);
	createInitialTasksFile(targetDir, report);

	copyTemplateFile(
		'env.example',
		path.join(targetDir, ENV_EXAMPLE_FILE),
		report
	);
	const configPath = path.join(targetDir, TASKGRAPH_CONFIG_FILE);
	copyTemplateFile('config.json', configPath, report);
	updateConfigMaxTokens(configPath, report);
	updateStorageConfig(configPath, report);
	// Per-machine settings an earlier release kept in the shared config.json
	// go to the gitignored config.local.json
	const movedMachineSettings = moveMachineSettings(targetDir, report);

	try {
		manageGitignoreFile(
			path.join(targetDir, GITIGNORE_FILE),
			readAsset('gitignore'),
			storeTasksInGit,
			(level, message) => {
				if (level === 'error') report('error', message);
				else log.debug(message);
			}
		);
	} catch (error) {
		report('error', `Failed to create .gitignore: ${(error as Error).message}`);
	}

	copyTemplateFile(
		'example_prd.txt',
		path.join(targetDir, EXAMPLE_PRD_FILE),
		report
	);
	copyTemplateFile(
		'example_prd_rpg.txt',
		path.join(targetDir, TASKGRAPH_TEMPLATES_DIR, 'example_prd_rpg.txt'),
		report
	);

	// A repository unless --no-git or there already is one
	try {
		if (initGit && !isInsideGitWorkTree(targetDir)) {
			execFileSync('git', ['init'], { cwd: targetDir, stdio: 'ignore' });
		}
	} catch {
		report('warn', 'Git not available, skipping repository initialization');
	}

	// Let Git merge tasks.json by task, so two branches that both add a task
	// don't conflict (#210). Pointless when tasks.json isn't committed.
	if (storeTasksInGit && isInsideGitWorkTree(targetDir)) {
		try {
			setUpMergeDriver(targetDir);
		} catch (error) {
			report(
				'warn',
				`Couldn't set up the tasks.json merge driver: ${(error as Error).message}`
			);
		}
	}

	if (options.claudeCode) {
		setUpClaudeCode(targetDir, { mcp: options.mcp === true }, report);
	}

	if (options.responseLanguage) {
		try {
			const result = setResponseLanguage(targetDir, options.responseLanguage);
			if (!result.success) throw new Error(result.error.message);
		} catch (error) {
			report(
				'warn',
				`Failed to set response language: ${(error as Error).message}`
			);
		}
	}

	const imported = options.importUpstream
		? importUpstreamProject(targetDir)
		: undefined;

	if (options.aliases) addShellAliases();

	const { alreadySetUp, changes } = describeInitChanges(
		targetDir,
		before,
		snapshotPaths(watched)
	);
	// Listed whether config.local.json is new or already had settings. A
	// move needs an existing config.json, so this is the first row.
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

	return { alreadySetUp, changes, hints, imported, problems };
}
