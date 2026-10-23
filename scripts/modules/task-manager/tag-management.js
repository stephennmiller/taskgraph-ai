import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

import { ui } from '@tm/cli';
import { theme } from '@tm/cli/theme';
import {
	copyArchivedTag,
	deleteArchivedTag,
	filterReadyTasks,
	isReservedNewTagName,
	isTaskComplete,
	readArchivedIdsSync,
	renameArchivedTag,
	getOwnKey
} from '@tm/core';
import {
	findProjectRoot,
	getCurrentTag,
	getTasksForTag,
	isTagData,
	log,
	readJSON,
	resolveTag,
	modifyJSON,
	withoutReadJSONFields,
	writeJSON
} from '../utils.js';
import findNextTask from './find-next-task.js';

const TAG_NAME_HINT = 'Use letters, numbers, - and _, like `feature-auth`';

const RESERVED_TAG_NAMES = ['master', 'main', 'default'];

/** Whether a new tag may not take this name */
function isReservedTagName(name) {
	return (
		RESERVED_TAG_NAMES.includes(name.toLowerCase()) ||
		isReservedNewTagName(name)
	);
}

/** An error the CLI prints with a hint underneath */
function tagNameError(message) {
	const error = new Error(message);
	error.hint = TAG_NAME_HINT;
	return error;
}

/**
 * Read tasks.json, treating a missing file as an empty master tag. A project
 * has no tasks.json until its first task is added, and listing or creating
 * tags shouldn't fail before then.
 * @throws {Error} If the file exists but can't be read
 */
function readTasksOrEmpty(tasksPath, projectRoot) {
	const data = readJSON(tasksPath, projectRoot);
	if (data) return data;
	if (!fs.existsSync(tasksPath)) {
		return {
			master: {
				tasks: [],
				metadata: {
					created: new Date().toISOString(),
					description: 'Tasks for master context'
				}
			}
		};
	}
	throw new Error(`Could not read tasks file at ${tasksPath}`);
}

/**
 * Create a new tag context
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} tagName - Name of the new tag to create
 * @param {Object} options - Options object
 * @param {boolean} [options.copyFromCurrent=false] - Whether to copy tasks from current tag
 * @param {string} [options.copyFromTag] - Specific tag to copy tasks from
 * @param {string} [options.description] - Optional description for the tag
 * @param {string} [options.defaultDescription] - Stored when description is empty, but not printed as the user's
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with tag creation details
 */
async function createTag(
	tasksPath,
	tagName,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;
	const {
		copyFromCurrent = false,
		copyFromTag,
		description,
		defaultDescription = `Tag created on ${new Date().toLocaleDateString()}`
	} = options;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		// Validate tag name
		if (!tagName || typeof tagName !== 'string') {
			throw new Error('Tag name is required and must be a string');
		}

		// Validate tag name format (alphanumeric, hyphens, underscores only)
		if (!/^[a-zA-Z0-9_-]+$/.test(tagName)) {
			throw tagNameError(`"${tagName}" isn't a valid tag name`);
		}

		// Reserved tag names
		if (isReservedTagName(tagName)) {
			throw new Error(`"${tagName}" is a reserved tag name`);
		}

		logFn.debug(`Creating new tag: ${tagName}`);

		// Read current tasks data
		const data = readTasksOrEmpty(tasksPath, projectRoot);

		// Use raw tagged data for tag operations - ensure we get the actual tagged structure
		let rawData;
		if (data._rawTaggedData) {
			// If we have _rawTaggedData, use it (this is the clean tagged structure)
			rawData = data._rawTaggedData;
		} else if (data.tasks && !data.master) {
			// This is legacy format - create a master tag structure
			rawData = {
				master: {
					tasks: data.tasks,
					metadata: data.metadata || {
						created: new Date().toISOString(),
						updated: new Date().toISOString(),
						description: 'Tasks live here by default'
					}
				}
			};
		} else {
			// This is already in tagged format, use it directly but exclude internal fields
			rawData = withoutReadJSONFields(data);
		}

		// Check if tag already exists
		if (getOwnKey(rawData, tagName)) {
			throw new Error(`Tag "${tagName}" already exists`);
		}

		// Determine source for copying tasks (only if explicitly requested)
		let sourceTasks = [];
		let sourceTag = null;
		if (copyFromCurrent || copyFromTag) {
			sourceTag = copyFromTag || getCurrentTag(projectRoot);
			sourceTasks = getTasksForTag(rawData, sourceTag);

			if (copyFromTag && sourceTasks.length === 0) {
				logFn.warn(`Source tag "${copyFromTag}" not found or has no tasks`);
			}

			logFn.debug(
				`Copying ${sourceTasks.length} tasks from tag "${sourceTag}"`
			);
		} else {
			logFn.debug('Creating empty tag (no tasks copied)');
		}

		// Create the new tag structure in raw data
		rawData[tagName] = {
			tasks: [...sourceTasks], // Create a copy of the tasks array
			metadata: {
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				description: description || defaultDescription
			}
		};

		// Create clean data for writing (exclude _rawTaggedData to prevent corruption)
		const cleanData = withoutReadJSONFields(rawData);

		// Write the clean data back to file with proper context to avoid tag corruption
		writeJSON(tasksPath, cleanData, projectRoot);
		// A copy keeps the source's archived tasks, so its dependencies on them
		// still count as done and their IDs stay reserved
		if (sourceTag) {
			await copyArchivedTag(tasksPath, sourceTag, tagName);
		}

		logFn.debug(`Successfully created tag "${tagName}"`);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				tagName,
				created: true,
				tasksCopied: sourceTasks.length,
				sourceTag:
					copyFromCurrent || copyFromTag
						? copyFromTag || getCurrentTag(projectRoot)
						: null,
				description: description || defaultDescription
			};
		}

		if (outputFormat === 'text') {
			console.log(
				ui.formatTagCreated({
					tagName,
					tasksCopied: sourceTasks.length,
					sourceTag:
						copyFromCurrent || copyFromTag
							? copyFromTag || getCurrentTag(projectRoot)
							: null,
					description
				})
			);
		}

		return {
			tagName,
			created: true,
			tasksCopied: sourceTasks.length,
			sourceTag:
				copyFromCurrent || copyFromTag
					? copyFromTag || getCurrentTag(projectRoot)
					: null,
			description: description || defaultDescription
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) logFn.error(`Error creating tag: ${error.message}`);
		throw error;
	}
}

/**
 * Delete an existing tag
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} tagName - Name of the tag to delete
 * @param {Object} options - Options object
 * @param {boolean} [options.yes=false] - Skip confirmation prompts
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with deletion details
 */
async function deleteTag(
	tasksPath,
	tagName,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;
	const { yes = false } = options;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		// Validate tag name
		if (!tagName || typeof tagName !== 'string') {
			throw new Error('Tag name is required and must be a string');
		}

		// Prevent deletion of master tag
		if (tagName === 'master') {
			throw new Error('Cannot delete the "master" tag');
		}

		logFn.debug(`Deleting tag: ${tagName}`);

		// Read current tasks data
		const data = readJSON(tasksPath, projectRoot);
		if (!data) {
			throw new Error(`Could not read tasks file at ${tasksPath}`);
		}

		// Use raw tagged data for tag operations - ensure we get the actual tagged structure
		let rawData;
		if (data._rawTaggedData) {
			// If we have _rawTaggedData, use it (this is the clean tagged structure)
			rawData = data._rawTaggedData;
		} else if (data.tasks && !data.master) {
			// This is legacy format - create a master tag structure
			rawData = {
				master: {
					tasks: data.tasks,
					metadata: data.metadata || {
						created: new Date().toISOString(),
						updated: new Date().toISOString(),
						description: 'Tasks live here by default'
					}
				}
			};
		} else {
			// This is already in tagged format, use it directly but exclude internal fields
			rawData = withoutReadJSONFields(data);
		}

		// Check if tag exists
		if (!getOwnKey(rawData, tagName)) {
			throw new Error(`Tag "${tagName}" does not exist`);
		}

		// Get current tag to check if we're deleting the active tag
		const currentTag = getCurrentTag(projectRoot);
		const isCurrentTag = currentTag === tagName;

		// Get task count for confirmation
		const tasks = getTasksForTag(rawData, tagName);
		const taskCount = tasks.length;

		// If not forced and has tasks, require confirmation (for CLI)
		if (!yes && taskCount > 0 && outputFormat === 'text') {
			const what = `tag ${tagName} and its ${taskCount === 1 ? 'task' : `${taskCount} tasks`}`;
			// Without a terminal a prompt would wait forever
			if (!(process.stdin.isTTY && process.stdout.isTTY)) {
				const error = new Error(`Deleting ${what} needs confirmation`);
				error.hint = 'Pass `--yes` to delete it without asking';
				throw error;
			}

			let proceed = false;
			try {
				const prompt = inquirer.createPromptModule({ clearPromptOnDone: true });
				({ proceed } = await prompt([
					{
						type: 'confirm',
						name: 'proceed',
						message: `Delete ${what}? This can't be undone.`,
						default: false
					}
				]));
			} catch (error) {
				if (error?.name !== 'ExitPromptError') throw error;
				// Ctrl-C
				console.log(theme.muted('Cancelled; nothing was deleted'));
				process.exit(130);
			}

			if (!proceed) {
				console.log(theme.muted('Cancelled; nothing was deleted'));
				return { tagName, deleted: false, cancelled: true };
			}
		}

		// Delete the tag from the file as it is now: it may have changed while
		// the question above was open
		await modifyJSON(tasksPath, (current) => {
			delete current[tagName];
			return current;
		});
		// Its archived tasks go with it
		await deleteArchivedTag(tasksPath, tagName);

		// If we're deleting the current tag, switch to master
		if (isCurrentTag) {
			await switchCurrentTag(projectRoot, 'master');
			logFn.debug('Switched current tag to "master"');
		}

		logFn.debug(`Successfully deleted tag "${tagName}"`);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				tagName,
				deleted: true,
				tasksDeleted: taskCount,
				wasCurrentTag: isCurrentTag,
				switchedToMaster: isCurrentTag
			};
		}

		if (outputFormat === 'text') {
			console.log(
				ui.formatTagDeleted({
					tagName,
					tasksDeleted: taskCount,
					switchedToMaster: isCurrentTag
				})
			);
		}

		return {
			tagName,
			deleted: true,
			tasksDeleted: taskCount,
			wasCurrentTag: isCurrentTag,
			switchedToMaster: isCurrentTag
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) logFn.error(`Error deleting tag: ${error.message}`);
		throw error;
	}
}

/**
 * Enhance existing tags with metadata if they don't have it
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {Object} rawData - The raw tagged data
 * @param {Object} context - Context object
 * @returns {Promise<boolean>} True if any tags were enhanced
 */
async function enhanceTagsWithMetadata(tasksPath, rawData, context = {}) {
	let enhanced = false;

	try {
		// Get file stats for creation date fallback
		let fileCreatedDate;
		try {
			const stats = fs.statSync(tasksPath);
			fileCreatedDate =
				stats.birthtime < stats.mtime ? stats.birthtime : stats.mtime;
		} catch (error) {
			fileCreatedDate = new Date();
		}

		for (const [tagName, tagData] of Object.entries(rawData)) {
			// Skip non-tag properties
			if (tagName === 'tasks' || !isTagData(tagData)) {
				continue;
			}

			// Check if tag needs metadata enhancement
			if (!tagData.metadata) {
				tagData.metadata = {};
				enhanced = true;
			}

			// Add missing metadata fields
			if (!tagData.metadata.created) {
				tagData.metadata.created = fileCreatedDate.toISOString();
				enhanced = true;
			}

			if (!tagData.metadata.description) {
				if (tagName === 'master') {
					tagData.metadata.description = 'Tasks live here by default';
				} else {
					tagData.metadata.description = `Tag created on ${new Date(tagData.metadata.created).toLocaleDateString()}`;
				}
				enhanced = true;
			}

			// Add updated field if missing (set to created date initially)
			if (!tagData.metadata.updated) {
				tagData.metadata.updated = tagData.metadata.created;
				enhanced = true;
			}
		}

		// If we enhanced any tags, write the data back
		if (enhanced) {
			// Create clean data for writing (exclude _rawTaggedData to prevent corruption)
			const cleanData = withoutReadJSONFields(rawData);
			writeJSON(tasksPath, cleanData, context.projectRoot);
		}
	} catch (error) {
		// Don't throw - just log and continue
		const logFn = context.mcpLog || {
			warn: (...args) => log('warn', ...args)
		};
		logFn.warn(`Could not enhance tag metadata: ${error.message}`);
	}

	return enhanced;
}

/**
 * List all available tags with metadata
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {Object} options - Options object
 * @param {boolean} [options.showTaskCounts=true] - Whether to show task counts
 * @param {boolean} [options.showMetadata=false] - Whether to show metadata
 * @param {boolean} [options.ready=false] - Whether to filter to only tags with ready tasks
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with tags list
 */
async function tags(
	tasksPath,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;
	const {
		showTaskCounts = true,
		showMetadata = false,
		ready = false
	} = options;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		logFn.debug('Listing available tags');

		logFn.debug('Using file storage for tags');

		// Read current tasks data
		const data = readTasksOrEmpty(tasksPath, projectRoot);

		// Get current tag
		const currentTag = getCurrentTag(projectRoot);

		// Use raw tagged data if available, otherwise use the data directly
		const rawData = data._rawTaggedData || data;

		// Enhance existing tags with metadata if they don't have it
		await enhanceTagsWithMetadata(tasksPath, rawData, context);

		// Extract all tags
		const tagList = [];
		for (const [tagName, tagData] of Object.entries(rawData)) {
			// Skip non-tag properties, like a legacy 'tasks' array
			if (tagName === 'tasks' || !isTagData(tagData)) {
				continue;
			}

			const tasks = tagData.tasks || [];
			const metadata = tagData.metadata || {};

			// Use centralized filtering from @tm/core
			// Note: filterReadyTasks expects TaskWithBlocks[] but only uses status/dependencies at runtime
			const tasksWithBlocks = tasks.map((t) => ({ ...t, blocks: [] }));
			// Dependencies on the tag's archived tasks count as done
			const readyTasks = filterReadyTasks(
				tasksWithBlocks,
				readArchivedIdsSync(tasksPath, tagName).ids
			);

			tagList.push({
				name: tagName,
				isCurrent: tagName === currentTag,
				completedTasks: tasks.filter((t) => isTaskComplete(t.status)).length,
				readyTasks: readyTasks.length,
				tasks: tasks || [],
				created: metadata.created || 'Unknown',
				description: metadata.description || 'No description'
			});
		}

		// Sort tags: current tag first, then alphabetically
		tagList.sort((a, b) => {
			if (a.isCurrent) return -1;
			if (b.isCurrent) return 1;
			return a.name.localeCompare(b.name);
		});

		// Filter to only tags with ready tasks if --ready flag is set
		let filteredTagList = tagList;
		if (ready) {
			filteredTagList = tagList.filter((tag) => tag.readyTasks > 0);
			logFn.debug(
				`Filtered to ${filteredTagList.length} tags with ready tasks`
			);
		}

		logFn.debug(`Found ${filteredTagList.length} tags`);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				tags: filteredTagList,
				currentTag,
				totalTags: filteredTagList.length
			};
		}

		if (outputFormat === 'text') {
			console.log(
				ui.formatTagList(
					filteredTagList.map((tag) => ({
						name: tag.name,
						isCurrent: tag.isCurrent,
						taskCount: tag.tasks.length,
						readyTasks: tag.readyTasks,
						completedTasks: tag.completedTasks,
						created: tag.created,
						description: tag.description
					})),
					{ showMetadata, ready }
				)
			);
		}

		return {
			tags: filteredTagList,
			currentTag,
			totalTags: filteredTagList.length
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) logFn.error(`Error listing tags: ${error.message}`);
		throw error;
	}
}

/**
 * Switch to a different tag context
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} tagName - Name of the tag to switch to
 * @param {Object} options - Options object
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with switch details
 */
async function useTag(
	tasksPath,
	tagName,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		// Validate tag name
		if (!tagName || typeof tagName !== 'string') {
			throw new Error('Tag name is required and must be a string');
		}

		logFn.debug(`Switching to tag: ${tagName}`);

		logFn.debug('Using file storage for tag switch');

		// Read current tasks data to verify tag exists
		const data = readJSON(tasksPath, projectRoot);
		if (!data) {
			throw new Error(`Could not read tasks file at ${tasksPath}`);
		}

		// Use raw tagged data to check if tag exists
		const rawData = data._rawTaggedData || data;

		// Check if tag exists
		if (!getOwnKey(rawData, tagName)) {
			throw new Error(`Tag "${tagName}" does not exist`);
		}

		// Get current tag
		const previousTag = getCurrentTag(projectRoot);

		// Switch to the new tag
		await switchCurrentTag(projectRoot, tagName);

		// Get task count for the new tag - read tasks specifically for this tag
		const tagData = readJSON(tasksPath, projectRoot, tagName);
		const tasks = tagData ? tagData.tasks || [] : [];
		const taskCount = tasks.length;

		// Find the next task to work on in this tag
		const nextTask = findNextTask(
			tasks,
			null,
			readArchivedIdsSync(tasksPath, tagName).ids
		);

		logFn.debug(`Successfully switched to tag "${tagName}"`);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				previousTag,
				currentTag: tagName,
				switched: true,
				taskCount,
				nextTask
			};
		}

		if (outputFormat === 'text') {
			console.log(
				ui.formatTagSwitched({
					previousTag,
					currentTag: tagName,
					taskCount,
					nextTask
				})
			);
		}

		return {
			previousTag,
			currentTag: tagName,
			switched: true,
			taskCount,
			nextTask
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) {
			logFn.error(`Error switching tag: ${error.message}`);
		}
		throw error;
	}
}

/**
 * Rename an existing tag
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} oldName - Current name of the tag
 * @param {string} newName - New name for the tag
 * @param {Object} options - Options object
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with rename details
 */
async function renameTag(
	tasksPath,
	oldName,
	newName,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		// Validate parameters
		if (!oldName || typeof oldName !== 'string') {
			throw new Error('Old tag name is required and must be a string');
		}
		if (!newName || typeof newName !== 'string') {
			throw new Error('New tag name is required and must be a string');
		}

		// Validate new tag name format
		if (!/^[a-zA-Z0-9_-]+$/.test(newName)) {
			throw tagNameError(`"${newName}" isn't a valid tag name`);
		}

		// Prevent renaming master tag
		if (oldName === 'master') {
			throw new Error('Cannot rename the "master" tag');
		}

		// Reserved tag names
		if (isReservedTagName(newName)) {
			throw new Error(`"${newName}" is a reserved tag name`);
		}

		logFn.debug(`Renaming tag from "${oldName}" to "${newName}"`);

		// Read current tasks data
		const data = readJSON(tasksPath, projectRoot);
		if (!data) {
			throw new Error(`Could not read tasks file at ${tasksPath}`);
		}

		// Use raw tagged data for tag operations
		const rawData = data._rawTaggedData || data;

		// Check if old tag exists
		if (!getOwnKey(rawData, oldName)) {
			throw new Error(`Tag "${oldName}" does not exist`);
		}

		// Check if new tag name already exists
		if (getOwnKey(rawData, newName)) {
			throw new Error(`Tag "${newName}" already exists`);
		}

		// Get current tag to check if we're renaming the active tag
		const currentTag = getCurrentTag(projectRoot);
		const isCurrentTag = currentTag === oldName;

		// Rename the tag by copying data and deleting old
		rawData[newName] = { ...rawData[oldName] };

		// Update metadata if it exists
		if (rawData[newName].metadata) {
			rawData[newName].metadata.renamed = {
				from: oldName,
				date: new Date().toISOString()
			};
		}

		delete rawData[oldName];

		// If we're renaming the current tag, update the current tag reference
		if (isCurrentTag) {
			await switchCurrentTag(projectRoot, newName);
			logFn.debug(`Updated current tag reference to "${newName}"`);
		}

		// Create clean data for writing (exclude _rawTaggedData to prevent corruption)
		const cleanData = withoutReadJSONFields(rawData);

		// Write the clean data back to file with proper context to avoid tag corruption
		writeJSON(tasksPath, cleanData, projectRoot);
		// Its archived tasks move with it
		await renameArchivedTag(tasksPath, oldName, newName);

		// Get task count
		const tasks = getTasksForTag(rawData, newName);
		const taskCount = tasks.length;

		logFn.debug(`Successfully renamed tag from "${oldName}" to "${newName}"`);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				oldName,
				newName,
				renamed: true,
				taskCount,
				wasCurrentTag: isCurrentTag,
				isCurrentTag: isCurrentTag
			};
		}

		if (outputFormat === 'text') {
			console.log(ui.formatTagRenamed({ oldName, newName, isCurrentTag }));
		}

		return {
			oldName,
			newName,
			renamed: true,
			taskCount,
			wasCurrentTag: isCurrentTag,
			isCurrentTag: isCurrentTag
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) logFn.error(`Error renaming tag: ${error.message}`);
		throw error;
	}
}

/**
 * Copy an existing tag to create a new tag with the same tasks
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} sourceName - Name of the source tag to copy from
 * @param {string} targetName - Name of the new tag to create
 * @param {Object} options - Options object
 * @param {string} [options.description] - Optional description for the new tag
 * @param {Object} context - Context object containing session and projectRoot
 * @param {string} [context.projectRoot] - Project root path
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @returns {Promise<Object>} Result object with copy details
 */
async function copyTag(
	tasksPath,
	sourceName,
	targetName,
	options = {},
	context = {},
	outputFormat = 'text'
) {
	const { mcpLog, projectRoot } = context;
	const { description } = options;

	// Create a consistent logFn object regardless of context
	const logFn = mcpLog || {
		info: (...args) => log('info', ...args),
		warn: (...args) => log('warn', ...args),
		error: (...args) => log('error', ...args),
		debug: (...args) => log('debug', ...args),
		success: (...args) => log('success', ...args)
	};

	try {
		// Validate parameters
		if (!sourceName || typeof sourceName !== 'string') {
			throw new Error('Source tag name is required and must be a string');
		}
		if (!targetName || typeof targetName !== 'string') {
			throw new Error('Target tag name is required and must be a string');
		}

		// Validate target tag name format
		if (!/^[a-zA-Z0-9_-]+$/.test(targetName)) {
			throw tagNameError(`"${targetName}" isn't a valid tag name`);
		}

		// Reserved tag names
		if (isReservedTagName(targetName)) {
			throw new Error(`"${targetName}" is a reserved tag name`);
		}

		logFn.debug(`Copying tag from "${sourceName}" to "${targetName}"`);

		// Read current tasks data
		const data = readJSON(tasksPath, projectRoot);
		if (!data) {
			throw new Error(`Could not read tasks file at ${tasksPath}`);
		}

		// Use raw tagged data for tag operations
		const rawData = data._rawTaggedData || data;

		// Check if source tag exists
		if (!getOwnKey(rawData, sourceName)) {
			throw new Error(`Source tag "${sourceName}" does not exist`);
		}

		// Check if target tag already exists
		if (getOwnKey(rawData, targetName)) {
			throw new Error(`Target tag "${targetName}" already exists`);
		}

		// Get source tasks
		const sourceTasks = getTasksForTag(rawData, sourceName);

		// Create deep copy of the source tag data
		rawData[targetName] = {
			tasks: JSON.parse(JSON.stringify(sourceTasks)), // Deep copy tasks
			metadata: {
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				description:
					description ||
					`Copy of "${sourceName}" created on ${new Date().toLocaleDateString()}`,
				copiedFrom: {
					tag: sourceName,
					date: new Date().toISOString()
				}
			}
		};

		// Create clean data for writing (exclude _rawTaggedData to prevent corruption)
		const cleanData = withoutReadJSONFields(rawData);

		// Write the clean data back to file with proper context to avoid tag corruption
		writeJSON(tasksPath, cleanData, projectRoot);
		// Its archived tasks are copied too (see createTag)
		await copyArchivedTag(tasksPath, sourceName, targetName);

		logFn.debug(
			`Successfully copied tag from "${sourceName}" to "${targetName}"`
		);

		// For JSON output, return structured data
		if (outputFormat === 'json') {
			return {
				sourceName,
				targetName,
				copied: true,
				description:
					description ||
					`Copy of "${sourceName}" created on ${new Date().toLocaleDateString()}`
			};
		}

		if (outputFormat === 'text') {
			console.log(
				ui.formatTagCopied({
					sourceName,
					targetName,
					tasksCopied: sourceTasks.length
				})
			);
		}

		return {
			sourceName,
			targetName,
			copied: true,
			description:
				description ||
				`Copy of "${sourceName}" created on ${new Date().toLocaleDateString()}`
		};
	} catch (error) {
		// The CLI prints the thrown error itself; only MCP needs the log line
		if (mcpLog) logFn.error(`Error copying tag: ${error.message}`);
		throw error;
	}
}

/**
 * Helper function to switch the current tag in state.json
 * @param {string} projectRoot - Project root directory
 * @param {string} tagName - Name of the tag to switch to
 * @returns {Promise<void>}
 */
async function switchCurrentTag(projectRoot, tagName) {
	try {
		const statePath = path.join(projectRoot, '.taskgraph', 'state.json');

		// Read current state or create default
		let state = {};
		if (fs.existsSync(statePath)) {
			const rawState = fs.readFileSync(statePath, 'utf8');
			state = JSON.parse(rawState);
		}

		// Update current tag and timestamp
		state.currentTag = tagName;
		state.lastSwitched = new Date().toISOString();

		// Ensure other required state properties exist
		if (!state.branchTagMapping) {
			state.branchTagMapping = {};
		}
		if (state.migrationNoticeShown === undefined) {
			state.migrationNoticeShown = false;
		}

		// Write updated state
		fs.writeFileSync(statePath, JSON.stringify(state, null, 2), 'utf8');
	} catch (error) {
		log('warn', `Could not update current tag in state.json: ${error.message}`);
		// Don't throw - this is not critical for tag operations
	}
}

// Export all tag management functions
export {
	createTag,
	deleteTag,
	tags,
	useTag,
	renameTag,
	copyTag,
	switchCurrentTag
};
