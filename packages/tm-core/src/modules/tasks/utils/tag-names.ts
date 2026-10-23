/**
 * Names no new tag can take. JavaScript objects treat a `__proto__` key as
 * their prototype rather than as data, and the legacy scripts/ code that also
 * writes tasks.json uses `tag` and `_rawTaggedData` as fields of its own
 * (#399). A tag with one of these names already in the file (a hand edit) can
 * still be deleted or renamed.
 */
const NEW_TAG_RESERVED_NAMES: readonly string[] = [
	'__proto__',
	'tag',
	'_rawTaggedData'
];

/** Whether a tag about to be created may not take this name */
export function isReservedNewTagName(name: string): boolean {
	return NEW_TAG_RESERVED_NAMES.includes(name);
}
