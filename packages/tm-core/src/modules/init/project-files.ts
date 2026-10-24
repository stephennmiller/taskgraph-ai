/**
 * @fileoverview The files init writes into .taskgraph/ and copies from its
 * templates. Every step keeps a file the user already has.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE,
	TASKGRAPH_STATE_FILE,
	TASKGRAPH_TASKS_FILE
} from '../../common/constants/paths.js';
import { getLogger } from '../../common/logger/index.js';
import { SUPPORTED_MODELS } from '../ai/config-ai-host.js';
import {
	UNREADABLE_CONFIG,
	readConfigJson,
	writeSplitConfig
} from '../config/services/config-file.js';
import {
	hasPerMachineSettings,
	mergeMachineConfig
} from '../config/services/machine-config.js';
import { stampTasksFileSchemaVersion } from '../storage/adapters/file-storage/schema-version.js';
import { readAsset } from './assets.js';
import type { InitReport } from './claude-code.js';

const errorText = (error: unknown) => (error as Error).message;

/** state.json for a new project, unless there is one */
export function createInitialStateFile(
	targetDir: string,
	report: InitReport
): void {
	const stateFilePath = path.join(targetDir, TASKGRAPH_STATE_FILE);
	if (fs.existsSync(stateFilePath)) return;

	// A new project has nothing to migrate, so the "TaskGraph now supports
	// tags" notice for upgraded projects is marked as shown
	const initialState = {
		currentTag: 'master',
		lastSwitched: new Date().toISOString(),
		branchTagMapping: {},
		migrationNoticeShown: true
	};
	try {
		fs.writeFileSync(stateFilePath, JSON.stringify(initialState, null, 2));
	} catch (error) {
		report('error', `Failed to create state file: ${errorText(error)}`);
	}
}

/**
 * An empty tasks.json, so adding the first task by hand, listing tags and
 * every other command work before parse-prd has run. An existing file is
 * left alone.
 */
export function createInitialTasksFile(
	targetDir: string,
	report: InitReport
): void {
	const tasksPath = path.join(targetDir, TASKGRAPH_TASKS_FILE);
	if (fs.existsSync(tasksPath)) return;

	const emptyTasks = stampTasksFileSchemaVersion({
		master: {
			tasks: [],
			metadata: {
				created: new Date().toISOString(),
				description: 'Tasks for master context'
			}
		}
	});
	try {
		fs.writeFileSync(tasksPath, `${JSON.stringify(emptyTasks, null, 2)}\n`);
	} catch (error) {
		report('error', `Failed to create tasks file: ${errorText(error)}`);
	}
}

/** Copy `assets/<templateName>` to `targetPath`, unless the file exists */
export function copyTemplateFile(
	templateName: string,
	targetPath: string,
	report: InitReport
): void {
	let content: string;
	try {
		content = readAsset(templateName);
	} catch (error) {
		report(
			'error',
			(error as NodeJS.ErrnoException).code === 'ENOENT'
				? `Source file not found: ${templateName}`
				: `Couldn't read the ${templateName} template: ${errorText(error)}`
		);
		return;
	}
	if (fs.existsSync(targetPath)) {
		getLogger('Init').debug(`${targetPath} already exists, skipping.`);
		return;
	}
	try {
		fs.writeFileSync(targetPath, content);
	} catch (error) {
		report(
			'error',
			`Couldn't write ${path.basename(targetPath)}: ${errorText(error)}`
		);
	}
}

/**
 * Set each role's maxTokens in config.json from supported-models.json
 * @returns false when config.json can't be read or written
 */
export function updateConfigMaxTokens(
	configPath: string,
	report: InitReport
): boolean {
	try {
		const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
		for (const role of ['main', 'research', 'fallback']) {
			const model = config.models?.[role];
			if (!model) continue;
			const modelData = SUPPORTED_MODELS[model.provider]?.find(
				(m) => m.id === model.modelId
			);
			if (modelData?.max_tokens) model.maxTokens = modelData.max_tokens;
		}
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
		return true;
	} catch (error) {
		report('error', `Error updating config maxTokens: ${errorText(error)}`);
		return false;
	}
}

/** config.json's storage: local files, solo mode */
export function updateStorageConfig(
	configPath: string,
	report: InitReport
): void {
	try {
		if (!fs.existsSync(configPath)) {
			report(
				'warn',
				'Config file does not exist, skipping storage configuration'
			);
			return;
		}
		const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
		config.storage ??= {};
		config.storage.type = 'file';
		// 'solo' selects the standalone slash commands and rules
		config.storage.operatingMode = 'solo';
		fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
	} catch (error) {
		report(
			'error',
			`Failed to update storage configuration: ${errorText(error)}`
		);
	}
}

/**
 * Move per-machine settings an earlier release kept in the shared
 * config.json to the gitignored config.local.json
 * @returns true when settings moved
 */
export function moveMachineSettings(
	rootPath: string,
	report: InitReport
): boolean {
	try {
		const shared = readConfigJson(path.join(rootPath, TASKGRAPH_CONFIG_FILE));
		if (shared === UNREADABLE_CONFIG || !hasPerMachineSettings(shared)) {
			return false;
		}
		const local = readConfigJson(
			path.join(rootPath, TASKGRAPH_LOCAL_CONFIG_FILE)
		);
		// A broken config.local.json stays as it is; reading config reports it
		if (local === UNREADABLE_CONFIG) return false;
		writeSplitConfig(rootPath, mergeMachineConfig(shared, local));
		return true;
	} catch (error) {
		report('warn', `Couldn't move per-machine settings: ${errorText(error)}`);
		return false;
	}
}
