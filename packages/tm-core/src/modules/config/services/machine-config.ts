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
export const PER_MACHINE_CONFIG_KEYS = [
	'claudeCode.pathToClaudeCodeExecutable'
] as const;

function isPlainObject(value: unknown): value is JsonObject {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
	return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function getPath(obj: unknown, keyPath: string): unknown {
	let current: unknown = obj;
	for (const key of keyPath.split('.')) {
		if (!isPlainObject(current)) return undefined;
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
	return Object.entries(obj).flatMap(([key, value]) => {
		const keyPath = prefix ? `${prefix}.${key}` : key;
		return isPlainObject(value) ? leafPaths(value, keyPath) : [keyPath];
	});
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
		for (const [key, value] of Object.entries(over)) {
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
 *   changing a per-machine override doesn't change it for everyone.
 * - A setting in PER_MACHINE_CONFIG_KEYS always goes to config.local.json
 *   and is removed from config.json. This moves settings an earlier release
 *   wrote to the shared file.
 * - Everything else goes to config.json.
 *
 * @param config - The full config to save (usually shared + local merged)
 * @param currentShared - config.json as it is on disk, or null
 * @param currentLocal - config.local.json as it is on disk, or null
 */
export function splitMachineConfig<T extends object>(
	config: T,
	currentShared: object | null | undefined,
	currentLocal: object | null | undefined
): { shared: T; local: JsonObject } {
	const shared = clone(config) as unknown as JsonObject;
	const local: JsonObject = clone((currentLocal ?? {}) as JsonObject);

	for (const keyPath of leafPaths(currentLocal)) {
		const value = getPath(config, keyPath);
		if (value === undefined) deletePath(local, keyPath);
		else setPath(local, keyPath, clone(value));

		const sharedValue = getPath(currentShared, keyPath);
		if (sharedValue === undefined) deletePath(shared, keyPath);
		else setPath(shared, keyPath, clone(sharedValue));
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
