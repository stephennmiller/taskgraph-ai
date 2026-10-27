/**
 * Task IDs that are safe in a branch name, a directory name and a file name:
 * letters, digits, `-` and `_`, starting with a letter or digit. No dots
 * (subtasks, `..`), slashes or spaces.
 */
export function isSafeTaskId(id: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);
}
