/**
 * @fileoverview What gets written to .taskgraph/config.json and
 * config.local.json. The one writer for both: tm-core's settings (models,
 * response language) save through writeSplitConfig.
 *
 * Callers hand writeSplitConfig a merged config. Saving that whole object
 * pinned the defaults of the day into the project: when `defaultNumTasks`
 * changed from 10 to 0 (#329), projects that had saved 10 kept asking for
 * about 10 tasks (#336). So only keys the file has or that differ from the
 * defaults are saved (toSavedConfig).
 */

import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_LOCAL_CONFIG_FILE
} from '../../../common/constants/paths.js';
import { mergeMachineConfig, splitMachineConfig } from './machine-config.js';

type JsonObject = Record<string, any>;

/** The settings a project gets when config.json leaves them out */
export const DEFAULT_PROJECT_CONFIG = {
	models: {
		main: {
			provider: 'claude-code',
			modelId: 'sonnet',
			maxTokens: 64000,
			temperature: 0.2
		},
		research: {
			provider: 'claude-code',
			modelId: 'sonnet',
			maxTokens: 8700,
			temperature: 0.1
		},
		fallback: {
			provider: 'claude-code',
			modelId: 'sonnet',
			maxTokens: 64000,
			temperature: 0.2
		}
	},
	global: {
		logLevel: 'info',
		debug: false,
		// 0: parse-prd sizes the task list to the PRD
		defaultNumTasks: 0,
		defaultSubtasks: 5,
		defaultPriority: 'medium',
		projectName: 'TaskGraph',
		responseLanguage: 'English',
		enableCodebaseAnalysis: true
	},
	claudeCode: {}
};

const isPlainObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Keep the keys of `value` that the file already has or that differ from the
 * default. Nested objects (models.main, global, ...) follow the same rule.
 */
function keepSetKeys(
	value: JsonObject,
	saved: unknown,
	defaults: unknown
): JsonObject {
	const out: JsonObject = {};
	for (const key of inFileOrder(value, saved)) {
		const entry = value[key];
		const inFile = isPlainObject(saved) && Object.hasOwn(saved, key);
		const fallback = isPlainObject(defaults) ? defaults[key] : undefined;
		if (isPlainObject(entry) && isPlainObject(fallback)) {
			const nested = keepSetKeys(
				entry,
				isPlainObject(saved) ? saved[key] : undefined,
				fallback
			);
			if (inFile || Object.keys(nested).length > 0) out[key] = nested;
		} else if (inFile || !isDeepStrictEqual(entry, fallback)) {
			out[key] = entry;
		}
	}
	return out;
}

/** Keys of `value`: those the file has in the file's order, then the rest */
function inFileOrder(value: JsonObject, saved: unknown): string[] {
	const fileKeys = isPlainObject(saved)
		? Object.keys(saved).filter((key) => Object.hasOwn(value, key))
		: [];
	return [
		...fileKeys,
		...Object.keys(value).filter((key) => !fileKeys.includes(key))
	];
}

/**
 * The object to write to config.json: the file's keys, updated from `config`,
 * plus any key whose value isn't the default. A key that only repeats a
 * default stays out of the file, so a later default change reaches the
 * project. A key missing from `config` is removed, except top-level sections
 * the loader doesn't read, which are kept as the file has them.
 * @param config - Merged config to save
 * @param saved - What config.json holds now, or null
 * @param defaults - The built-in defaults
 */
export function toSavedConfig(
	config: JsonObject,
	saved: unknown,
	defaults: JsonObject
): JsonObject {
	const file = isPlainObject(saved) ? saved : {};
	const kept = keepSetKeys(config, file, defaults);
	pinModelPairs(kept.models, config.models);
	// Keep the file's key order, so a save changes only the lines it must
	const out: JsonObject = {};
	for (const [key, value] of Object.entries(file)) {
		if (!Object.hasOwn(defaults, key)) out[key] = value;
		else if (Object.hasOwn(kept, key)) out[key] = kept[key];
	}
	return { ...out, ...kept };
}

/**
 * A saved model role that names a provider or a modelId names both: a modelId
 * only means something with its provider, the loader ignores a fallback
 * without both, and a later default provider must not change the user's
 * model. A role that saves only other keys (such as temperature) keeps
 * following the default model.
 */
function pinModelPairs(savedModels: unknown, models: unknown): void {
	if (!isPlainObject(savedModels) || !isPlainObject(models)) return;
	for (const [role, saved] of Object.entries(savedModels)) {
		const model = models[role];
		if (!isPlainObject(saved) || !isPlainObject(model)) continue;
		if (!Object.hasOwn(saved, 'provider') && !Object.hasOwn(saved, 'modelId')) {
			continue;
		}
		for (const key of ['provider', 'modelId']) {
			if (model[key] !== undefined && !Object.hasOwn(saved, key)) {
				saved[key] = model[key];
			}
		}
	}
}

/**
 * Before #329 every AI command saved the merged defaults, including
 * `"defaultNumTasks": 10` and `"enableProxy": false`. `init` never writes
 * `enableProxy`, so a file with both is one the old save wrote, and its 10 is
 * the old default rather than a count the user chose. Remove both: the count
 * then follows the PRD, and with `enableProxy` gone a 10 the user sets later
 * is kept.
 * @param saved - Parsed config.json
 * @returns The cleaned config, or null when nothing changes
 */
export function dropOldNumTasksDefault(saved: unknown): JsonObject | null {
	const global = isPlainObject(saved) ? saved.global : undefined;
	if (
		!isPlainObject(global) ||
		global.defaultNumTasks !== 10 ||
		global.enableProxy !== false
	) {
		return null;
	}
	const { defaultNumTasks, enableProxy, ...rest } = global;
	return { ...(saved as JsonObject), global: rest };
}

/** Marks a file that exists but isn't valid JSON (see readConfigJson) */
export const UNREADABLE_CONFIG = Symbol('unreadable');

/**
 * Parse a config file for saving
 * @returns null when missing, UNREADABLE_CONFIG when it isn't valid JSON
 * @throws When the file can't be read (permissions, a directory)
 */
export function readConfigJson(
	filePath: string
): JsonObject | null | typeof UNREADABLE_CONFIG {
	if (!fs.existsSync(filePath)) return null;
	const text = fs.readFileSync(filePath, 'utf-8');
	try {
		return JSON.parse(text);
	} catch {
		return UNREADABLE_CONFIG;
	}
}

/**
 * Write a config to config.json and config.local.json. Per-machine settings
 * go to config.local.json (gitignored), the rest to config.json, so a
 * per-machine setting an earlier release wrote to config.json moves to the
 * local file on the next write. config.json gets only the keys it already
 * has or that differ from the defaults (see toSavedConfig).
 * Throws, writing nothing, when config.json isn't valid JSON.
 * @param rootPath - Project root
 * @param config - Full config (shared and local merged)
 */
export function writeSplitConfig(rootPath: string, config: JsonObject): void {
	const configPath = path.join(rootPath, TASKGRAPH_CONFIG_FILE);
	const localPath = path.join(rootPath, TASKGRAPH_LOCAL_CONFIG_FILE);
	const currentShared = readConfigJson(configPath);
	if (currentShared === UNREADABLE_CONFIG) {
		// Saving over it would replace the user's settings with defaults
		throw new Error(
			`${TASKGRAPH_CONFIG_FILE} isn't valid JSON; fix it before changing settings`
		);
	}
	const currentLocal = readConfigJson(localPath);
	if (currentLocal === UNREADABLE_CONFIG) {
		// Leave a broken config.local.json for the user to fix rather than
		// overwrite the settings in it; save everything to config.json as
		// before config.local.json existed.
		fs.writeFileSync(
			configPath,
			JSON.stringify(
				toSavedConfig(config, currentShared, DEFAULT_PROJECT_CONFIG),
				null,
				2
			)
		);
		return;
	}
	const { shared, local } = splitMachineConfig(
		config,
		currentShared,
		currentLocal,
		DEFAULT_PROJECT_CONFIG
	);

	// Local file first: if the shared write then fails, a moved setting is
	// in both files rather than in neither
	if (currentLocal || Object.keys(local).length > 0) {
		fs.writeFileSync(localPath, `${JSON.stringify(local, null, 2)}\n`);
	}
	fs.writeFileSync(
		configPath,
		JSON.stringify(
			toSavedConfig(shared, currentShared, DEFAULT_PROJECT_CONFIG),
			null,
			2
		)
	);
}

/**
 * The project's global.logLevel, lower-cased: config.local.json over
 * config.json, 'info' when neither sets it. A file that isn't valid JSON is
 * skipped. Read synchronously, for a logger set up at startup.
 * @throws When a file can't be read (permissions, a directory)
 */
export function readLogLevel(rootPath: string): string {
	const read = (file: string) => {
		const json = readConfigJson(path.join(rootPath, file));
		return json === UNREADABLE_CONFIG ? null : json;
	};
	const config = mergeMachineConfig<JsonObject>(
		read(TASKGRAPH_CONFIG_FILE),
		read(TASKGRAPH_LOCAL_CONFIG_FILE)
	);
	const level = config.global?.logLevel;
	return typeof level === 'string'
		? level.toLowerCase()
		: DEFAULT_PROJECT_CONFIG.global.logLevel;
}
