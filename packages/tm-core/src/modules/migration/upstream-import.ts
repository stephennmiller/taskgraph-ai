/**
 * @fileoverview Import a Task Master project (`.taskmaster/`) into TaskGraph
 * (`.taskgraph/`). The task format is the same, so tasks.json moves as is,
 * with every tag. Docs, reports and templates are copied. Config keeps only
 * what TaskGraph uses: Claude model roles and the general settings. Provider
 * names, base URLs and API-key settings are dropped. `.taskmaster/` is never
 * changed. The folder may come from someone else's checkout, so symlinks that
 * lead outside it (or outside the project, on the TaskGraph side) are refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { stampTasksFileSchemaVersion } from '../storage/adapters/file-storage/schema-version.js';
import { resolvesWithin } from './import-paths.js';

// The only source file that names the project TaskGraph was forked from:
// everything else refers to it through these constants, so the package
// identity check (tests/unit/package-identity.test.js) stays meaningful.

/** Display name of the upstream project */
export const UPSTREAM_NAME = 'Task Master';
/** Its project folder */
export const UPSTREAM_DIR = '.taskmaster';
/** The `init` flag that imports it, and the option key Commander gives it */
export const UPSTREAM_IMPORT_FLAG = '--from-taskmaster';
export const UPSTREAM_IMPORT_OPTION = 'fromTaskmaster';

const TASKGRAPH_DIR = '.taskgraph';
const TASKS_FILE = path.join('tasks', 'tasks.json');
const CONFIG_FILE = 'config.json';
const STATE_FILE = 'state.json';

/** Folders copied file by file; files already in .taskgraph/ are kept */
const COPIED_FOLDERS = ['docs', 'reports', 'templates'] as const;
export type CopiedFolder = (typeof COPIED_FOLDERS)[number];

const MODEL_ROLES = ['main', 'research', 'fallback'] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** Claude Code's model aliases, matched against a Task Master model ID */
const CLAUDE_MODELS = ['opus', 'sonnet', 'haiku'] as const;

/**
 * `global` settings TaskGraph still reads. Everything else (base URLs,
 * Vertex/Bedrock/Azure settings, user IDs, proxies) belongs to providers
 * TaskGraph removed and is dropped.
 */
/**
 * `claudeCode` settings carried over. The rest can hold secrets (MCP server
 * `env` and `headers`), run another program (`pathToClaudeCodeExecutable`)
 * or widen permissions (`permissionMode`), so they are dropped and listed.
 */
const KEPT_CLAUDE_CODE_SETTINGS = [
	'maxTurns',
	'customSystemPrompt',
	'appendSystemPrompt',
	'allowedTools',
	'disallowedTools'
];

const KEPT_GLOBAL_SETTINGS = [
	'logLevel',
	'debug',
	'defaultNumTasks',
	'defaultSubtasks',
	'defaultPriority',
	'projectName',
	'defaultTag',
	'responseLanguage',
	'enableCodebaseAnalysis'
];

/** Dropped `global` key for Task Master's saved task count, see below */
export const DROPPED_NUM_TASKS_SETTING = 'global.defaultNumTasks';

/**
 * Task Master saves every default, so its `defaultNumTasks: 10` is rarely a
 * count the user chose. Leaving it out lets parse-prd size the list to the
 * PRD (TaskGraph's default, 0). Any other count is the user's and is kept.
 */
const isSavedNumTasksDefault = (key: string, value: unknown) =>
	key === 'defaultNumTasks' && value === 10;

export const UPSTREAM_IMPORT_ERRORS = {
	NO_UPSTREAM_PROJECT: 'NO_UPSTREAM_PROJECT',
	TASKGRAPH_HAS_TASKS: 'TASKGRAPH_HAS_TASKS',
	INVALID_JSON: 'INVALID_JSON',
	UNSAFE_PATH: 'UNSAFE_PATH'
} as const;

export type UpstreamImportErrorCode =
	(typeof UPSTREAM_IMPORT_ERRORS)[keyof typeof UPSTREAM_IMPORT_ERRORS];

/** Why an import can't run, with the fix to show under the message */
export class UpstreamImportError extends Error {
	constructor(
		readonly code: UpstreamImportErrorCode,
		message: string,
		readonly hint: string
	) {
		super(message);
		this.name = 'UpstreamImportError';
	}
}

export interface ImportedTag {
	name: string;
	/** Top-level tasks in the tag (subtasks not counted) */
	tasks: number;
}

export interface ImportedModel {
	role: ModelRole;
	/** Claude Code alias the role now uses: opus, sonnet or haiku */
	modelId: string;
}

export interface DroppedModel {
	role: ModelRole;
	provider: string;
	modelId: string;
}

export interface UpstreamImportResult {
	/** Tags copied from tasks.json, in file order */
	tags: ImportedTag[];
	/** Top-level tasks across every tag */
	taskCount: number;
	/** Files copied per folder (files already in .taskgraph/ aren't counted) */
	copiedFiles: Record<CopiedFolder, number>;
	/** Model roles that map to a Claude Code model */
	keptModels: ImportedModel[];
	/** Model roles on another provider; TaskGraph's default stays */
	droppedModels: DroppedModel[];
	/**
	 * Config keys left behind: provider, API-key and unsafe Claude Code
	 * settings, and Task Master's saved default task count
	 */
	droppedSettings: string[];
	/** The tag Task Master had selected, if it was carried over */
	currentTag?: string;
}

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Read a JSON file, or undefined when it doesn't exist */
function readJson(file: string, shown: string): unknown {
	if (!fs.existsSync(file)) return undefined;
	const text = fs.readFileSync(file, 'utf8');
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new UpstreamImportError(
			UPSTREAM_IMPORT_ERRORS.INVALID_JSON,
			`${shown} isn't valid JSON: ${(error as Error).message}`,
			`Fix ${shown}, then run \`taskgraph init ${UPSTREAM_IMPORT_FLAG}\` again`
		);
	}
}

/**
 * Tag name → tag data. A file from before tags (`{"tasks": [...]}`) is the
 * `master` tag, the same way TaskGraph reads it.
 */
function toTaggedTasks(data: unknown): Record<string, JsonObject> {
	// No prototype: a tag named `__proto__` or `toString` is just a key
	const tagged: Record<string, JsonObject> = Object.create(null);
	if (!isObject(data)) return tagged;
	if (Array.isArray(data.tasks)) {
		const { tasks, ...rest } = data;
		tagged.master = { tasks, ...rest };
		return tagged;
	}
	for (const [name, value] of Object.entries(data)) {
		if (isObject(value) && Array.isArray(value.tasks)) tagged[name] = value;
	}
	return tagged;
}

const countTasks = (tagged: Record<string, JsonObject>) =>
	Object.values(tagged).reduce(
		(sum, tag) => sum + (tag.tasks as unknown[]).length,
		0
	);

/** Refuse `relative` (under `root`) when a symlink takes it outside `within` */
function assertResolvesWithin(
	within: string,
	root: string,
	relative: string
): void {
	if (resolvesWithin(within, path.join(root, relative))) return;
	const shown = path.join(path.basename(root), relative);
	throw new UpstreamImportError(
		UPSTREAM_IMPORT_ERRORS.UNSAFE_PATH,
		`${shown} is a link to somewhere outside ${path.basename(within)}/`,
		`Replace the link with the real file or folder, then run \`taskgraph init ${UPSTREAM_IMPORT_FLAG}\` again`
	);
}

/** Everything under `.taskgraph/` that init or the import writes to */
const TARGET_PATHS = [
	'',
	'tasks',
	TASKS_FILE,
	CONFIG_FILE,
	STATE_FILE,
	...COPIED_FOLDERS
];

/**
 * Check that `projectRoot` can be imported, before anything is written:
 * `.taskmaster/` exists inside the project, its JSON files parse, no symlink
 * leads a read or write out of place, and `.taskgraph/` has no tasks yet (an
 * empty tasks.json from `init` is fine).
 * @throws {UpstreamImportError}
 */
export function checkUpstreamImport(projectRoot: string): void {
	const source = path.join(projectRoot, UPSTREAM_DIR);
	if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
		throw new UpstreamImportError(
			UPSTREAM_IMPORT_ERRORS.NO_UPSTREAM_PROJECT,
			`No ${UPSTREAM_DIR}/ folder in ${path.basename(projectRoot) || projectRoot}`,
			`Run \`taskgraph init ${UPSTREAM_IMPORT_FLAG}\` from the folder that holds ${UPSTREAM_DIR}/`
		);
	}
	assertResolvesWithin(projectRoot, projectRoot, UPSTREAM_DIR);
	for (const file of [TASKS_FILE, CONFIG_FILE, STATE_FILE]) {
		assertResolvesWithin(source, source, file);
		readJson(path.join(source, file), `${UPSTREAM_DIR}/${file}`);
	}
	const target = path.join(projectRoot, TASKGRAPH_DIR);
	for (const relative of TARGET_PATHS) {
		assertResolvesWithin(projectRoot, target, relative);
	}

	const targetShown = `${TASKGRAPH_DIR}/tasks/tasks.json`;
	const existing = toTaggedTasks(
		readJson(path.join(projectRoot, TASKGRAPH_DIR, TASKS_FILE), targetShown)
	);
	const existingCount = countTasks(existing);
	if (existingCount > 0) {
		throw new UpstreamImportError(
			UPSTREAM_IMPORT_ERRORS.TASKGRAPH_HAS_TASKS,
			`${TASKGRAPH_DIR}/ already has ${existingCount} ${existingCount === 1 ? 'task' : 'tasks'}; the import would replace them`,
			`Move ${targetShown} aside first, or keep using it`
		);
	}
}

/**
 * Copy every file under `from` into `to`, keeping files already there.
 * Symlinks are skipped (a directory entry that is a link is neither a file
 * nor a folder), a folder that leads outside `fromRoot` isn't read, and one
 * that leads outside `toRoot` isn't written to.
 */
function copyNewFiles(
	from: string,
	to: string,
	fromRoot: string,
	toRoot: string
): number {
	const stat = fs.lstatSync(from, { throwIfNoEntry: false });
	if (!stat?.isDirectory() || !resolvesWithin(fromRoot, from)) return 0;
	if (!resolvesWithin(toRoot, to)) return 0;
	let copied = 0;
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copied += copyNewFiles(source, target, fromRoot, toRoot);
		} else if (entry.isFile()) {
			fs.mkdirSync(to, { recursive: true });
			try {
				// EXCL keeps an existing file, and won't follow a dangling symlink
				fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
				copied++;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			}
		}
	}
	return copied;
}

/** The Claude Code alias a Task Master model ID stands for, if any */
export function claudeModelFor(modelId: unknown): string | undefined {
	if (typeof modelId !== 'string') return undefined;
	const id = modelId.toLowerCase();
	return CLAUDE_MODELS.find((alias) => id.includes(alias));
}

interface ConfigImport {
	config: JsonObject;
	keptModels: ImportedModel[];
	droppedModels: DroppedModel[];
	droppedSettings: string[];
}

/**
 * Merge the parts of a Task Master config TaskGraph uses into `target`.
 * Each Claude model role becomes a `claude-code` role with its alias; other
 * roles keep TaskGraph's model. Kept roles take their token and temperature
 * limits from `target`, since Task Master's were for another provider.
 */
export function importUpstreamConfig(
	source: unknown,
	target: JsonObject = {}
): ConfigImport {
	const config: JsonObject = structuredClone(target);
	const keptModels: ImportedModel[] = [];
	const droppedModels: DroppedModel[] = [];
	const droppedSettings: string[] = [];
	if (!isObject(source)) {
		return { config, keptModels, droppedModels, droppedSettings };
	}

	const sourceModels = isObject(source.models) ? source.models : {};
	const models: JsonObject = isObject(config.models) ? config.models : {};
	for (const role of MODEL_ROLES) {
		const model = sourceModels[role];
		if (!isObject(model)) continue;
		const alias = claudeModelFor(model.modelId);
		if (alias) {
			const current = isObject(models[role]) ? models[role] : {};
			models[role] = { ...current, provider: 'claude-code', modelId: alias };
			keptModels.push({ role, modelId: alias });
		} else {
			droppedModels.push({
				role,
				provider: String(model.provider ?? 'unknown'),
				modelId: String(model.modelId ?? 'unknown')
			});
		}
	}
	if (keptModels.length > 0) config.models = models;

	const sourceGlobal = isObject(source.global) ? source.global : {};
	const global: JsonObject = isObject(config.global) ? config.global : {};
	for (const [key, value] of Object.entries(sourceGlobal)) {
		if (
			KEPT_GLOBAL_SETTINGS.includes(key) &&
			!isSavedNumTasksDefault(key, value)
		) {
			global[key] = value;
		} else droppedSettings.push(`global.${key}`);
	}
	config.global = global;

	// Claude Code's own settings still apply, except the risky ones
	if (isObject(source.claudeCode)) {
		const claudeCode: JsonObject = isObject(config.claudeCode)
			? config.claudeCode
			: {};
		for (const [key, value] of Object.entries(source.claudeCode)) {
			if (KEPT_CLAUDE_CODE_SETTINGS.includes(key)) claudeCode[key] = value;
			else droppedSettings.push(`claudeCode.${key}`);
		}
		config.claudeCode = claudeCode;
	}

	for (const key of Object.keys(source)) {
		if (!['models', 'global', 'claudeCode'].includes(key)) {
			droppedSettings.push(key);
		}
	}

	return { config, keptModels, droppedModels, droppedSettings };
}

const writeJson = (file: string, data: unknown) => {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

/**
 * Import `.taskmaster/` into `.taskgraph/` under `projectRoot`. Runs
 * {@link checkUpstreamImport} first, so nothing is written when it can't
 * finish. `.taskmaster/` is left untouched.
 * @throws {UpstreamImportError}
 */
export function importUpstreamProject(
	projectRoot: string
): UpstreamImportResult {
	checkUpstreamImport(projectRoot);
	const source = path.join(projectRoot, UPSTREAM_DIR);
	const target = path.join(projectRoot, TASKGRAPH_DIR);

	// Tasks: every tag, as Task Master wrote them
	const tagged = toTaggedTasks(
		readJson(path.join(source, TASKS_FILE), `${UPSTREAM_DIR}/tasks/tasks.json`)
	);
	const tags = Object.entries(tagged).map(([name, tag]) => ({
		name,
		tasks: (tag.tasks as unknown[]).length
	}));
	if (tags.length > 0)
		writeJson(
			path.join(target, TASKS_FILE),
			stampTasksFileSchemaVersion(tagged)
		);

	const copiedFiles = Object.fromEntries(
		COPIED_FOLDERS.map((folder) => [
			folder,
			copyNewFiles(
				path.join(source, folder),
				path.join(target, folder),
				source,
				projectRoot
			)
		])
	) as Record<CopiedFolder, number>;

	// Config: model roles that map to Claude Code and the general settings
	const configPath = path.join(target, CONFIG_FILE);
	const targetConfig = readJson(configPath, `${TASKGRAPH_DIR}/${CONFIG_FILE}`);
	const { config, keptModels, droppedModels, droppedSettings } =
		importUpstreamConfig(
			readJson(
				path.join(source, CONFIG_FILE),
				`${UPSTREAM_DIR}/${CONFIG_FILE}`
			),
			isObject(targetConfig) ? targetConfig : {}
		);
	if (fs.existsSync(path.join(source, CONFIG_FILE)) || targetConfig) {
		writeJson(configPath, config);
	}

	// State: keep the selected tag and branch mapping when the tag came over
	let currentTag: string | undefined;
	const sourceState = readJson(
		path.join(source, STATE_FILE),
		`${UPSTREAM_DIR}/${STATE_FILE}`
	);
	if (isObject(sourceState)) {
		const statePath = path.join(target, STATE_FILE);
		const existing = readJson(statePath, `${TASKGRAPH_DIR}/${STATE_FILE}`);
		const state: JsonObject = isObject(existing) ? existing : {};
		if (
			typeof sourceState.currentTag === 'string' &&
			Object.hasOwn(tagged, sourceState.currentTag)
		) {
			currentTag = sourceState.currentTag;
			state.currentTag = currentTag;
		}
		if (isObject(sourceState.branchTagMapping)) {
			state.branchTagMapping = sourceState.branchTagMapping;
		}
		writeJson(statePath, state);
	}

	return {
		tags,
		taskCount: countTasks(tagged),
		copiedFiles,
		keptModels,
		droppedModels,
		droppedSettings,
		currentTag
	};
}
