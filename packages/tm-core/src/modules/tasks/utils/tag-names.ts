import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import { DEFAULT_CONFIG_VALUES } from '../../../common/interfaces/configuration.interface.js';

/**
 * The characters a tag name may use: letters, numbers, hyphens and
 * underscores. Such a name is also safe to put in a shell command or a file name.
 */
export const TAG_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Check a tag against TAG_NAME_PATTERN. Only new tags are checked when
 * created, so run this on any tag (stored or passed) that goes into a file name.
 * @throws {TaskGraphError} VALIDATION_ERROR, with a hint, when it doesn't match
 */
export function assertTagName(name: string): void {
	if (TAG_NAME_PATTERN.test(name)) return;
	const error = new TaskGraphError(
		// JSON.stringify: a hand-edited name may hold control characters
		`${JSON.stringify(name)} isn't a valid tag name`,
		ERROR_CODES.VALIDATION_ERROR
	);
	// The CLI prints the hint under the message
	throw Object.assign(error, {
		hint: 'Use letters, numbers, - and _, like `feature-auth`'
	});
}

/**
 * What a tag already in a project may hold to be listed or printed. A checkout
 * can put anything there, and commands print tags outside any data fence, so
 * no spaces, line breaks or shell characters. Wider than TAG_NAME_PATTERN:
 * tags like `a/b` from before names were checked still work.
 */
export const STORED_TAG_PATTERN = /^[a-zA-Z0-9_./-]+$/;

/**
 * A tag read from a project's files (or its .env), or the default tag when it
 * isn't safe to print
 */
export function storedTagOrDefault(tag: unknown): string {
	return typeof tag === 'string' && STORED_TAG_PATTERN.test(tag)
		? tag
		: DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG;
}

/**
 * Names no new tag can take. JavaScript objects treat a `__proto__` key as
 * their prototype rather than as data, and the legacy scripts/ code that also
 * writes tasks.json uses `tag` and `_rawTaggedData` as fields of its own
 * (#399). `tasks` and `metadata` are the keys of an untagged tasks.json, so
 * a tag with either name is hard to tell from that file shape (#802). A tag
 * with one of these names already in the file can still be deleted or renamed.
 */
const NEW_TAG_RESERVED_NAMES: readonly string[] = [
	'__proto__',
	'tag',
	'_rawTaggedData',
	'tasks',
	'metadata'
];

/** Whether a tag about to be created may not take this name */
export function isReservedNewTagName(name: string): boolean {
	return NEW_TAG_RESERVED_NAMES.includes(name);
}
