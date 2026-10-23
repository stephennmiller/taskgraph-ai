/**
 * What config-manager writes to .taskgraph/config.json, kept apart from the
 * loader so the rules are easy to test.
 *
 * config-manager hands writeConfig the merged config, with every default
 * filled in. Saving that whole object pinned the defaults of the day into the
 * project: when `defaultNumTasks` changed from 10 to 0 (#329), projects that
 * had saved 10 kept asking for about 10 tasks (#336).
 */
import { isDeepStrictEqual } from 'node:util';

const isPlainObject = (value) =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Keep the keys of `value` that the file already has or that differ from the
 * default. Nested objects (models.main, global, ...) follow the same rule.
 */
function keepSetKeys(value, saved, defaults) {
	const out = {};
	for (const [key, entry] of Object.entries(value)) {
		const inFile = isPlainObject(saved) && Object.hasOwn(saved, key);
		const fallback = isPlainObject(defaults) ? defaults[key] : undefined;
		if (isPlainObject(entry) && isPlainObject(fallback)) {
			const nested = keepSetKeys(entry, saved?.[key], fallback);
			if (inFile || Object.keys(nested).length > 0) out[key] = nested;
		} else if (inFile || !isDeepStrictEqual(entry, fallback)) {
			out[key] = entry;
		}
	}
	return out;
}

/**
 * The object to write to config.json: the file's keys, updated from `config`,
 * plus any key whose value isn't the default. A key that only repeats a
 * default stays out of the file, so a later default change reaches the
 * project. A key missing from `config` is removed, except top-level sections
 * the loader doesn't read, which are kept as the file has them.
 * @param {object} config - Merged config to save
 * @param {object|null} saved - What config.json holds now, or null
 * @param {object} defaults - The built-in defaults
 * @returns {object}
 */
export function toSavedConfig(config, saved, defaults) {
	const file = isPlainObject(saved) ? saved : {};
	const unread = Object.fromEntries(
		Object.entries(file).filter(([key]) => !Object.hasOwn(defaults, key))
	);
	return { ...unread, ...keepSetKeys(config, file, defaults) };
}

/**
 * Before #329 every AI command saved the merged defaults, including
 * `"defaultNumTasks": 10` and `"enableProxy": false`. `init` never writes
 * `enableProxy`, so a file with both is one the old save wrote, and its 10 is
 * the old default rather than a count the user chose. Remove both: the count
 * then follows the PRD, and with `enableProxy` gone a 10 the user sets later
 * is kept.
 * @param {object} saved - Parsed config.json
 * @returns {object|null} The cleaned config, or null when nothing changes
 */
export function dropOldNumTasksDefault(saved) {
	const global = saved?.global;
	if (
		!isPlainObject(global) ||
		global.defaultNumTasks !== 10 ||
		global.enableProxy !== false
	) {
		return null;
	}
	const { defaultNumTasks, enableProxy, ...rest } = global;
	return { ...saved, global: rest };
}
