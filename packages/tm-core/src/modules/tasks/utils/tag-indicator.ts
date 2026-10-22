/**
 * @fileoverview When a command should print its `[tag] <name>` line
 * The line tells you which task list a command works in. In a project that
 * has only ever had the master tag it tells you nothing, so commands skip it
 * and start with their result.
 */

import fs from 'node:fs';
import { DEFAULT_CONFIG_VALUES } from '../../../common/interfaces/configuration.interface.js';
import { getProjectPaths } from '../../../common/utils/path-helpers.js';
import { FormatHandler } from '../../storage/adapters/file-storage/format-handler.js';

const DEFAULT_TAG = DEFAULT_CONFIG_VALUES.TAGS.DEFAULT_TAG;

/**
 * Show the tag line when you're on a tag other than master, or when the
 * project has more than one tag to choose from
 * @param tag - The tag the command works in
 * @param tagNames - Every tag in the project
 */
export function shouldShowTagIndicator(
	tag: string,
	tagNames: readonly string[]
): boolean {
	if (tag !== DEFAULT_TAG) return true;
	return new Set(tagNames).size > 1;
}

/**
 * The tag names in a tasks.json file, read synchronously so a command can
 * decide before it prints anything
 * @returns The tags, or [] when the file is missing or not valid JSON
 */
export function readTagNamesSync(tasksPath: string): string[] {
	try {
		const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		return new FormatHandler().extractTags(data);
	} catch {
		return [];
	}
}

/**
 * Whether a command in this project should print its tag line
 * @param tag - The tag the command works in
 * @param projectRoot - The project; found from the working directory when omitted
 */
export function shouldShowTagIndicatorForProject(
	tag: string,
	projectRoot?: string
): boolean {
	if (tag !== DEFAULT_TAG) return true;
	const { tasksPath } = getProjectPaths(projectRoot);
	return shouldShowTagIndicator(tag, readTagNamesSync(tasksPath));
}
