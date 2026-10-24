/**
 * @fileoverview The `-f, --file` flag the legacy commands took. Commands on
 * tm-core always use the project's tasks.json, so the flag is hidden and
 * only that file is accepted: a script passing it keeps working, and one
 * naming another file fails instead of changing the project's file.
 */

import path from 'node:path';
import { getProjectPaths } from '@tm/core';
import { Option } from 'commander';
import { terminalSafe } from '../ui/formatters/markdown-formatters.js';

export const legacyFileOption = (): Option =>
	new Option('-f, --file <file>').hideHelp();

/**
 * An error when `file` names something other than the project's tasks.json
 * @param file - The --file value, relative to the project root
 * @param commands - What uses the project's file, for the message ("tag commands")
 * @param projectPath - The --project value, if any
 */
export function otherTasksFileError(
	file: string | undefined,
	commands: string,
	projectPath?: string
): Error | undefined {
	if (file === undefined) return undefined;
	const { projectRoot, tasksPath } = getProjectPaths(projectPath);
	if (path.resolve(projectRoot, file) === path.resolve(tasksPath)) {
		return undefined;
	}
	return Object.assign(
		new Error(
			`--file is no longer supported: ${commands} use ${terminalSafe(tasksPath)}`
		),
		{ hint: 'Run the command from the project that holds the tasks file' }
	);
}
