/**
 * @fileoverview Per-machine settings in `.taskgraph/config.local.json`
 *
 * `.taskgraph/config.json` is committed and shared by everyone on the
 * project. `.taskgraph/config.local.json` sits next to it, is gitignored, and
 * holds settings that only make sense on one machine, such as the absolute
 * path to the `claude` executable. Loading merges the local file over the
 * shared one; saving splits a config back into the two files.
 */

/** Plain JSON object, as read from a config file */
type JsonObject = Record<string, unknown>;

/**
 * Settings that belong to one machine. Saving always writes them to
 * config.local.json, and moves them there from config.json if an earlier
 * release put them in the shared file.
 */
const PER_MACHINE_CONFIG_KEYS = [
	'claudeCode.pathToClaudeCodeExecutable'
] as const;

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Keys that reach Object.prototype through `obj[key]`. A config file that
 * names one is skipped there, so it can't change the prototype of every
 * object in the process.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Own entries of a parsed config object, without UNSAFE_KEYS */
function safeEntries(obj: JsonObject): [string, unknown][] {
	return Object.entries(obj).filter(([key]) => !UNSAFE_KEYS.has(key));
}

function clone<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function getPath(obj: unknown, keyPath: string): unknown {
	let current: unknown = obj;
	for (const key of keyPath.split('.')) {
		if (!isPlainObject(current) || !Object.hasOwn(current, key)) {
			return undefined;
		}
		current = current[key];
	}
	return current;
}

function setPath(obj: JsonObject, keyPath: string, value: unknown): void {
	const keys = keyPath.split('.');
	let current = obj;
	for (const key of keys.slice(0, -1)) {
		if (!isPlainObject(current[key])) current[key] = {};
		current = current[key] as JsonObject;
	}
	current[keys[keys.length - 1]] = value;
}

/** Delete a key, then any parent objects the delete left empty */
function deletePath(obj: JsonObject, keyPath: string): void {
	const keys = keyPath.split('.');
	const parents: JsonObject[] = [obj];
	for (const key of keys.slice(0, -1)) {
		const next = parents[parents.length - 1][key];
		if (!isPlainObject(next)) return;
		parents.push(next);
	}
	delete parents[parents.length - 1][keys[keys.length - 1]];
	for (let i = parents.length - 1; i > 0; i--) {
		if (Object.keys(parents[i]).length > 0) break;
		delete parents[i - 1][keys[i - 1]];
	}
}

/** Dot paths of every non-object value in `obj` */
function leafPaths(obj: unknown, prefix = ''): string[] {
	if (!isPlainObject(obj)) return [];
	return safeEntries(obj).flatMap(([key, value]) => {
		const keyPath = prefix ? `${prefix}.${key}` : key;
		return isPlainObject(value) ? leafPaths(value, keyPath) : [keyPath];
	});
}

/**
 * Settings that change together, saved as one: a model role's modelId,
 * maxTokens and temperature. When config.local.json overrides any key of a
 * unit, a save keeps the whole unit's changes local, so switching a
 * locally overridden model doesn't write its maxTokens to config.json.
 * Any other path is its own unit.
 */
function overrideUnit(keyPath: string): string {
	const [first, second] = keyPath.split('.');
	return first === 'models' && second ? `models.${second}` : keyPath;
}

function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Merge config.local.json over config.json. Objects merge key by key; any
 * other value in the local file (string, number, array) replaces the shared
 * one. Neither input is changed.
 *
 * @param shared - Parsed config.json, or null when it doesn't exist
 * @param local - Parsed config.local.json, or null when it doesn't exist
 */
export function mergeMachineConfig<T extends object>(
	shared: T | null | undefined,
	local: object | null | undefined
): T {
	const merge = (base: unknown, over: unknown): unknown => {
		if (!isPlainObject(over)) return over === undefined ? base : clone(over);
		const result: JsonObject = isPlainObject(base) ? { ...base } : {};
		for (const [key, value] of safeEntries(over)) {
			result[key] = merge(result[key], value);
		}
		return result;
	};
	return merge(clone(shared ?? {}), local ?? {}) as T;
}

/**
 * Split a config about to be saved into what goes in config.json and what
 * goes in config.local.json.
 *
 * - A setting the local file already overrides stays local: the new value
 *   goes to config.local.json and config.json keeps the value it had, so
 *   changing a per-machine override doesn't change it for everyone. For a
 *   model role this covers the whole role (see overrideUnit).
 * - A setting in PER_MACHINE_CONFIG_KEYS always goes to config.local.json
 *   and is removed from config.json. This moves settings an earlier release
 *   wrote to the shared file.
 * - Everything else goes to config.json.
 *
 * @param config - The full config to save (usually shared + local merged)
 * @param currentShared - config.json as it is on disk, or null
 * @param currentLocal - config.local.json as it is on disk, or null
 * @param defaults - The defaults the loader fills in under config.json. A key
 *   of a local model role that only repeats config.json's value, or the
 *   default config.json leaves out, isn't a local change and stays out of
 *   config.local.json.
 */
export function splitMachineConfig<T extends object>(
	config: T,
	currentShared: object | null | undefined,
	currentLocal: object | null | undefined,
	defaults?: object | null
): { shared: T; local: JsonObject } {
	const shared = clone(config) as unknown as JsonObject;
	const local: JsonObject = clone((currentLocal ?? {}) as JsonObject);
	const effectiveShared = mergeMachineConfig(defaults, currentShared);

	const units = new Set(leafPaths(currentLocal).map(overrideUnit));
	for (const unit of units) {
		const value = getPath(config, unit);
		const sharedValue = getPath(currentShared, unit);
		const localValue = getPath(currentLocal, unit);

		if (value === undefined) deletePath(local, unit);
		else if (isPlainObject(value) && isPlainObject(localValue)) {
			// Keys the local file had, plus keys that now differ from config.json
			const effectiveValue = getPath(effectiveShared, unit);
			const sharedObject = isPlainObject(effectiveValue) ? effectiveValue : {};
			const localObject: JsonObject = {};
			for (const [key, keyValue] of safeEntries(value)) {
				if (key in localValue || !sameValue(keyValue, sharedObject[key])) {
					localObject[key] = clone(keyValue);
				}
			}
			setPath(local, unit, localObject);
		} else setPath(local, unit, clone(value));

		if (sharedValue === undefined) deletePath(shared, unit);
		else setPath(shared, unit, clone(sharedValue));
	}

	for (const keyPath of PER_MACHINE_CONFIG_KEYS) {
		const value = getPath(config, keyPath);
		if (value === undefined) continue;
		setPath(local, keyPath, clone(value));
		deletePath(shared, keyPath);
	}

	return { shared: shared as unknown as T, local };
}

/**
 * Whether config.json holds a per-machine setting that saving would move to
 * config.local.json.
 */
export function hasPerMachineSettings(
	sharedConfig: object | null | undefined
): boolean {
	return PER_MACHINE_CONFIG_KEYS.some(
		(keyPath) => getPath(sharedConfig, keyPath) !== undefined
	);
}
