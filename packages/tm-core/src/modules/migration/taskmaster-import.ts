/**
 * @fileoverview Import a Task Master project (`.taskmaster/`) into TaskGraph
 * (`.taskgraph/`). The task format is the same, so tasks.json moves as is,
 * with every tag. Docs, reports and templates are copied. Config keeps only
 * what TaskGraph uses: Claude model roles and the general settings. Provider
 * names, base URLs and API-key settings are dropped. `.taskmaster/` is never
 * changed.
 */

import fs from 'node:fs';
import path from 'node:path';

export const TASKMASTER_DIR = '.taskmaster';

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

export const TASKMASTER_IMPORT_ERRORS = {
	NO_TASKMASTER_PROJECT: 'NO_TASKMASTER_PROJECT',
	TASKGRAPH_HAS_TASKS: 'TASKGRAPH_HAS_TASKS',
	INVALID_JSON: 'INVALID_JSON'
} as const;

export type TaskMasterImportErrorCode =
	(typeof TASKMASTER_IMPORT_ERRORS)[keyof typeof TASKMASTER_IMPORT_ERRORS];

/** Why an import can't run, with the fix to show under the message */
export class TaskMasterImportError extends Error {
	constructor(
		readonly code: TaskMasterImportErrorCode,
		message: string,
		readonly hint: string
	) {
		super(message);
		this.name = 'TaskMasterImportError';
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

export interface TaskMasterImportResult {
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
	/** Config keys left behind: provider settings and API-key settings */
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
		throw new TaskMasterImportError(
			TASKMASTER_IMPORT_ERRORS.INVALID_JSON,
			`${shown} isn't valid JSON: ${(error as Error).message}`,
			`Fix ${shown}, then run \`taskgraph init --from-taskmaster\` again`
		);
	}
}

/**
 * Tag name → tag data. A file from before tags (`{"tasks": [...]}`) is the
 * `master` tag, the same way TaskGraph reads it.
 */
function toTaggedTasks(data: unknown): Record<string, JsonObject> {
	if (!isObject(data)) return {};
	if (Array.isArray(data.tasks)) {
		const { tasks, ...rest } = data;
		return { master: { tasks, ...rest } };
	}
	const tagged: Record<string, JsonObject> = {};
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

/**
 * Check that `projectRoot` can be imported, before anything is written:
 * `.taskmaster/` exists, its tasks.json parses, and `.taskgraph/` has no tasks
 * yet (an empty tasks.json from `init` is fine).
 * @throws {TaskMasterImportError}
 */
export function checkTaskMasterImport(projectRoot: string): void {
	const source = path.join(projectRoot, TASKMASTER_DIR);
	if (!fs.statSync(source, { throwIfNoEntry: false })?.isDirectory()) {
		throw new TaskMasterImportError(
			TASKMASTER_IMPORT_ERRORS.NO_TASKMASTER_PROJECT,
			`No ${TASKMASTER_DIR}/ folder in ${path.basename(projectRoot) || projectRoot}`,
			`Run \`taskgraph init --from-taskmaster\` from the folder that holds ${TASKMASTER_DIR}/`
		);
	}
	readJson(path.join(source, TASKS_FILE), `${TASKMASTER_DIR}/tasks/tasks.json`);

	const targetShown = `${TASKGRAPH_DIR}/tasks/tasks.json`;
	const existing = toTaggedTasks(
		readJson(path.join(projectRoot, TASKGRAPH_DIR, TASKS_FILE), targetShown)
	);
	const existingCount = countTasks(existing);
	if (existingCount > 0) {
		throw new TaskMasterImportError(
			TASKMASTER_IMPORT_ERRORS.TASKGRAPH_HAS_TASKS,
			`${TASKGRAPH_DIR}/ already has ${existingCount} ${existingCount === 1 ? 'task' : 'tasks'}; the import would replace them`,
			`Move ${targetShown} aside first, or keep using it`
		);
	}
}

/** Copy every file under `from` into `to`, keeping files already there */
function copyNewFiles(from: string, to: string): number {
	if (!fs.statSync(from, { throwIfNoEntry: false })?.isDirectory()) return 0;
	let copied = 0;
	for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
		const source = path.join(from, entry.name);
		const target = path.join(to, entry.name);
		if (entry.isDirectory()) {
			copied += copyNewFiles(source, target);
		} else if (entry.isFile() && !fs.existsSync(target)) {
			fs.mkdirSync(to, { recursive: true });
			fs.copyFileSync(source, target);
			copied++;
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
export function importTaskMasterConfig(
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
		if (KEPT_GLOBAL_SETTINGS.includes(key)) global[key] = value;
		else droppedSettings.push(`global.${key}`);
	}
	config.global = global;

	// Claude Code's own settings (allowed tools and the like) still apply
	if (isObject(source.claudeCode)) config.claudeCode = source.claudeCode;

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
 * {@link checkTaskMasterImport} first, so nothing is written when it can't
 * finish. `.taskmaster/` is left untouched.
 * @throws {TaskMasterImportError}
 */
export function importTaskMasterProject(
	projectRoot: string
): TaskMasterImportResult {
	checkTaskMasterImport(projectRoot);
	const source = path.join(projectRoot, TASKMASTER_DIR);
	const target = path.join(projectRoot, TASKGRAPH_DIR);

	// Tasks: every tag, as Task Master wrote them
	const tagged = toTaggedTasks(
		readJson(
			path.join(source, TASKS_FILE),
			`${TASKMASTER_DIR}/tasks/tasks.json`
		)
	);
	const tags = Object.entries(tagged).map(([name, tag]) => ({
		name,
		tasks: (tag.tasks as unknown[]).length
	}));
	if (tags.length > 0) writeJson(path.join(target, TASKS_FILE), tagged);

	const copiedFiles = Object.fromEntries(
		COPIED_FOLDERS.map((folder) => [
			folder,
			copyNewFiles(path.join(source, folder), path.join(target, folder))
		])
	) as Record<CopiedFolder, number>;

	// Config: model roles that map to Claude Code and the general settings
	const configPath = path.join(target, CONFIG_FILE);
	const targetConfig = readJson(configPath, `${TASKGRAPH_DIR}/${CONFIG_FILE}`);
	const { config, keptModels, droppedModels, droppedSettings } =
		importTaskMasterConfig(
			readJson(
				path.join(source, CONFIG_FILE),
				`${TASKMASTER_DIR}/${CONFIG_FILE}`
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
		`${TASKMASTER_DIR}/${STATE_FILE}`
	);
	if (isObject(sourceState)) {
		const statePath = path.join(target, STATE_FILE);
		const existing = readJson(statePath, `${TASKGRAPH_DIR}/${STATE_FILE}`);
		const state: JsonObject = isObject(existing) ? existing : {};
		if (
			typeof sourceState.currentTag === 'string' &&
			sourceState.currentTag in tagged
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
