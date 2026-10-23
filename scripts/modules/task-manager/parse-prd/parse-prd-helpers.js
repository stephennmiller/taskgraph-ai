/**
 * Helper functions for PRD parsing
 */

import { ui } from '@tm/cli';
import {
	PRD_SNAPSHOT_KEY,
	assignMetadata,
	formatPrdSectionList,
	nextTaskId,
	prdSourceMetadata,
	readArchivedIdsSync,
	reconcileDependencySources,
	setGeneratedCriteria,
	withPrdSnapshot
} from '@tm/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { displayParsePrdSummary } from '../../../../src/ui/parse-prd.js';
import { TimeoutManager } from '../../../../src/utils/timeout-manager.js';
import { getPromptManager } from '../../prompt-manager.js';
import { displayAiUsageSummary } from '../../ui.js';
import {
	ensureTagMetadata,
	findTaskById,
	withFileLockSync
} from '../../utils.js';
import { prdResponseSchema } from './parse-prd-config.js';

/**
 * The first complete top-level JSON object in a string, or null.
 * Strings and escapes are respected, so braces inside values don't count.
 * @param {string} text
 * @returns {string|null}
 */
export function firstJsonObject(text) {
	if (typeof text !== 'string') return null;
	const start = text.indexOf('{');
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === '\\') escaped = true;
			else if (ch === '"') inString = false;
		} else if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) return text.slice(start, i + 1);
		}
	}
	return null;
}

/**
 * Recover the task list from a model reply that failed to parse as a whole.
 * Claude Code sometimes repeats the JSON object, so the reply is two objects
 * back to back; the first is complete. Returns null unless it matches the
 * schema.
 * @param {string} text - The raw reply
 * @returns {{tasks: Array}|null}
 */
export function recoverTaskList(text) {
	const json = firstJsonObject(text);
	if (!json) return null;
	try {
		const result = prdResponseSchema.safeParse(JSON.parse(json));
		return result.success ? result.data : null;
	} catch {
		return null;
	}
}

/**
 * Estimate token count from text
 * @param {string} text - Text to estimate tokens for
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
	// Common approximation: ~4 characters per token for English
	return Math.ceil(text.length / 4);
}

/**
 * Read and validate PRD content
 * @param {string} prdPath - Path to PRD file
 * @returns {string} PRD content
 * @throws {Error} If file is empty or cannot be read
 */
export function readPrdContent(prdPath) {
	const prdContent = fs.readFileSync(prdPath, 'utf8');
	if (!prdContent) {
		throw new Error(`Input file ${prdPath} is empty or could not be read.`);
	}
	return prdContent;
}

/**
 * Load existing tasks from file
 * @param {string} tasksPath - Path to tasks file
 * @param {string} targetTag - Target tag to load from
 * @returns {{existingTasks: Array, nextId: number, firstFreeId: number, tagMetadata: Object}}
 *   Existing tasks; the next ID after them (for --append); the first ID no
 *   archived task holds (for an overwrite; archived IDs are never reused);
 *   and the tag's metadata (which holds the PRD section hashes of the last
 *   parse)
 */
export function loadExistingTasks(tasksPath, targetTag) {
	let existingTasks = [];

	const allData = readExistingTasksFile(tasksPath);
	const tagMetadata = allData[targetTag]?.metadata || {};

	if (allData[targetTag]?.tasks && Array.isArray(allData[targetTag].tasks)) {
		existingTasks = allData[targetTag].tasks;
	}

	const { highestId } = readArchivedIdsSync(tasksPath, targetTag);
	const nextId = nextTaskId(
		existingTasks.map((t) => t.id || 0),
		highestId
	);

	return { existingTasks, nextId, firstFreeId: highestId + 1, tagMetadata };
}

/**
 * Read the whole tasks file. A missing or empty file has no tags. A file that
 * exists but is not valid JSON throws: treating it as empty would skip the
 * overwrite check and the save would then replace every tag in it.
 * @param {string} tasksPath
 * @returns {Object} All tags in the file
 */
function readExistingTasksFile(tasksPath) {
	if (!fs.existsSync(tasksPath)) {
		return {};
	}

	const content = fs.readFileSync(tasksPath, 'utf8');
	if (content.trim() === '') {
		return {};
	}

	try {
		return JSON.parse(content);
	} catch (error) {
		throw new Error(
			`${tasksPath} is not valid JSON (${error.message}). Fix or remove the file, then run this again`
		);
	}
}

/**
 * Validate overwrite/append operations
 * @param {Object} params
 * @returns {void}
 * @throws {Error} If validation fails
 */
export function validateFileOperations({
	existingTasks,
	targetTag,
	append,
	force,
	isMCP,
	logger
}) {
	const hasExistingTasks = existingTasks.length > 0;

	if (!hasExistingTasks) {
		logger.report(
			`Tag '${targetTag}' is empty or doesn't exist. Creating/updating tag with new tasks.`,
			'debug'
		);
		return;
	}

	if (append) {
		logger.report(
			`Append mode enabled. Found ${existingTasks.length} existing tasks in tag '${targetTag}'.`,
			// The PRD change lines and the saved line say what --append did
			'debug'
		);
		return;
	}

	if (!force) {
		const errorMessage = `Tag '${targetTag}' already contains ${existingTasks.length} tasks. Use --force to overwrite or --append to add to existing tasks.`;
		logger.report(errorMessage, 'error');

		if (isMCP) {
			throw new Error(errorMessage);
		} else {
			console.error(chalk.red(errorMessage));
			process.exit(1);
		}
	}

	logger.report(
		`Force flag enabled. Overwriting existing tasks in tag '${targetTag}'.`,
		'debug'
	);
}

/**
 * Process and transform tasks with ID remapping
 * @param {Array} rawTasks - Raw tasks from AI
 * @param {number} startId - Starting ID for new tasks
 * @param {Array} existingTasks - Existing tasks for dependency validation
 * @param {string} defaultPriority - Default priority for tasks
 * @param {{path: string, sections: Array}} [prd] - The PRD's path and
 *   headings; a task naming one of them gets `metadata.source`
 * @returns {Array} Processed tasks with remapped IDs
 */
export function processTasks(
	rawTasks,
	startId,
	existingTasks,
	defaultPriority,
	prd
) {
	// Runtime guard: ensure PRD task IDs are unique and sequential (1..N).
	validateSequentialTaskIds(rawTasks, startId);

	let currentId = startId;
	const taskMap = new Map();

	// First pass: assign new IDs and create mapping
	const processedTasks = rawTasks.map(({ section, ...task }) => {
		const newId = currentId++;
		taskMap.set(task.id, newId);
		// Only a section the PRD has; an invented slug would point nowhere.
		// The section's hash lets a later --append tell whether it changed
		const source = prd
			? prdSourceMetadata(section, prd.sections, prd.path)
			: undefined;

		// The AI's criteria are stored as unchecked items (none: no field)
		return setGeneratedCriteria({
			...task,
			...(source ? { metadata: { ...task.metadata, ...source } } : {}),
			id: newId,
			status: task.status || 'pending',
			priority: task.priority || defaultPriority,
			dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
			subtasks: task.subtasks || [],
			// Ensure all required fields have values
			title: task.title || '',
			description: task.description || '',
			details: task.details || '',
			testStrategy: task.testStrategy || ''
		});
	});

	// Second pass: remap dependencies
	processedTasks.forEach((task) => {
		task.dependencies = task.dependencies
			.map((depId) => taskMap.get(depId))
			.filter(
				(newDepId) =>
					newDepId != null &&
					newDepId < task.id &&
					(findTaskById(existingTasks, newDepId) ||
						processedTasks.some((t) => t.id === newDepId))
			);
		// The AI invented these dependencies, so record them as inferred
		assignMetadata(task, reconcileDependencySources(task));
	});

	return processedTasks;
}

function validateSequentialTaskIds(rawTasks, expectedStartId = 1) {
	if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
		return;
	}

	const ids = rawTasks.map((task) => task.id);

	if (ids.some((id) => !Number.isInteger(id) || id < 1)) {
		throw new Error(
			'PRD tasks must use sequential positive integer IDs starting at 1.'
		);
	}

	const uniqueIds = new Set(ids);
	if (uniqueIds.size !== ids.length) {
		throw new Error(
			'PRD task IDs must be unique and sequential starting at 1.'
		);
	}

	const sortedIds = [...uniqueIds].sort((a, b) => a - b);
	const startId = sortedIds[0];
	if (startId !== 1 && startId !== expectedStartId) {
		throw new Error(
			`PRD task IDs must start at 1 or ${expectedStartId} and be sequential.`
		);
	}

	for (let index = 0; index < sortedIds.length; index += 1) {
		if (sortedIds[index] !== startId + index) {
			throw new Error(
				`PRD task IDs must be a contiguous sequence starting at ${startId}.`
			);
		}
	}
}

/**
 * Save tasks to file with tag support. The read-modify-write runs under the
 * tasks file lock and the file is replaced atomically, so a concurrent
 * writer's other tags aren't lost and a crash can't leave half a file.
 * @param {string} tasksPath - Path to save tasks
 * @param {Array|null} tasks - Tasks to save, or null to keep the tag's tasks
 *   as they are in the file now (only the metadata changes)
 * @param {string} targetTag - Target tag
 * @param {Object} logger - Logger instance
 * @param {{path: string, snapshot: Object, replace?: boolean}} [prdSnapshot] -
 *   The PRD's section hashes, recorded in the tag so the next --append can
 *   tell what changed. With replace, other PRDs' hashes are dropped: their
 *   tasks were just replaced
 */
export function saveTasksToFile(
	tasksPath,
	tasks,
	targetTag,
	logger,
	prdSnapshot
) {
	// Create directory if it doesn't exist
	const tasksDir = path.dirname(tasksPath);
	if (!fs.existsSync(tasksDir)) {
		fs.mkdirSync(tasksDir, { recursive: true });
	}

	const saved = withFileLockSync(
		tasksPath,
		() => {
			// Read existing file to preserve other tags
			const outputData = readExistingTasksFile(tasksPath);
			const current = outputData[targetTag];
			const tagTasks =
				tasks ?? (Array.isArray(current?.tasks) ? current.tasks : []);

			// Update only the target tag
			outputData[targetTag] = {
				tasks: tagTasks,
				metadata: {
					// Keep what the tag already records (schemaVersion, counts, ...)
					...current?.metadata,
					created: current?.metadata?.created || new Date().toISOString(),
					updated: new Date().toISOString(),
					description: `Tasks for ${targetTag} context`,
					...(prdSnapshot
						? {
								[PRD_SNAPSHOT_KEY]: withPrdSnapshot(
									prdSnapshot.replace ? {} : current?.metadata,
									prdSnapshot.path,
									prdSnapshot.snapshot
								)
							}
						: {})
				}
			};

			// Ensure proper metadata
			ensureTagMetadata(outputData[targetTag], {
				description: `Tasks for ${targetTag} context`
			});

			// Write to a temp file and rename it over the tasks file
			const tempPath = `${tasksPath}.tmp.${process.pid}`;
			try {
				fs.writeFileSync(tempPath, JSON.stringify(outputData, null, 2));
				fs.renameSync(tempPath, tasksPath);
			} catch (error) {
				try {
					if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
				} catch {
					// The write error is the one to report
				}
				throw error;
			}
			return tagTasks.length;
		},
		{ createIfMissing: true }
	);

	logger.report(`Successfully saved ${saved} tasks to ${tasksPath}`, 'debug');
}

/**
 * Build prompts for AI service
 * @param {Object} config - Configuration object
 * @param {string} prdContent - PRD content
 * @param {number} nextId - Next task ID
 * @param {{sections: Array}} [prd] - The PRD's headings, for tasks to cite
 * @param {{numTasks?: number, newSectionsOnly?: boolean}} [options] -
 *   With newSectionsOnly, prdContent holds only the sections added since the
 *   last parse, and numTasks (0: the model decides) replaces config.numTasks
 * @returns {Promise<{systemPrompt: string, userPrompt: string}>}
 */
export async function buildPrompts(
	config,
	prdContent,
	nextId,
	prd,
	options = {}
) {
	const promptManager = getPromptManager();

	return promptManager.loadPrompt('parse-prd', {
		research: config.research,
		numTasks: options.numTasks ?? config.numTasks,
		newSectionsOnly: Boolean(options.newSectionsOnly),
		nextId,
		prdContent,
		prdPath: config.prdPath,
		prdSections: prd?.sections?.length
			? formatPrdSectionList(prd.sections)
			: '',
		hasCodebaseAnalysis: config.hasCodebaseAnalysis(),
		projectRoot: config.projectRoot || ''
	});
}

/**
 * Handle progress reporting for both CLI and MCP
 * @param {Object} params
 */
export async function reportTaskProgress({
	task,
	currentCount,
	totalTasks,
	estimatedTokens,
	progressTracker,
	reportProgress,
	priorityMap,
	defaultPriority,
	estimatedInputTokens
}) {
	const priority = task.priority || defaultPriority;
	const priorityIndicator = priorityMap[priority] || priorityMap.medium;

	// CLI progress tracker
	if (progressTracker) {
		progressTracker.addTaskLine(currentCount, task.title, priority);
		if (estimatedTokens) {
			progressTracker.updateTokens(estimatedInputTokens, estimatedTokens);
		}
	}

	// MCP progress reporting
	if (reportProgress) {
		try {
			// totalTasks is 0 when the model sizes the list, so there is no total
			const hasTotal = totalTasks > 0;
			const outputTokens =
				estimatedTokens && hasTotal
					? Math.floor(estimatedTokens / totalTasks)
					: 0;
			const position = hasTotal
				? `${currentCount}/${totalTasks}`
				: `${currentCount}`;
			const tokens = hasTotal ? ` | ~Output: ${outputTokens} tokens` : '';

			await reportProgress({
				progress: currentCount,
				...(hasTotal && { total: totalTasks }),
				message: `${priorityIndicator} Task ${position} - ${task.title}${tokens}`
			});
		} catch (error) {
			// Ignore progress reporting errors
		}
	}
}

/**
 * Display completion summary for CLI
 * @param {Object} params
 */
export async function displayCliSummary({
	processedTasks,
	nextId,
	summary,
	prdPath,
	tasksPath,
	usedFallback,
	aiServiceResponse
}) {
	// Generate task file names
	const taskFilesGenerated = (() => {
		if (!Array.isArray(processedTasks) || processedTasks.length === 0) {
			return `task_${String(nextId).padStart(3, '0')}.txt`;
		}
		const firstNewTaskId = processedTasks[0].id;
		const lastNewTaskId = processedTasks[processedTasks.length - 1].id;
		if (processedTasks.length === 1) {
			return `task_${String(firstNewTaskId).padStart(3, '0')}.txt`;
		}
		return `task_${String(firstNewTaskId).padStart(3, '0')}.txt -> task_${String(lastNewTaskId).padStart(3, '0')}.txt`;
	})();

	displayParsePrdSummary({
		totalTasks: processedTasks.length,
		taskPriorities: summary.taskPriorities,
		prdFilePath: prdPath,
		outputPath: tasksPath,
		elapsedTime: summary.elapsedTime,
		usedFallback,
		taskFilesGenerated,
		actionVerb: summary.actionVerb
	});

	// Display telemetry
	if (aiServiceResponse?.telemetryData) {
		// For streaming, wait briefly to allow usage data to be captured
		if (aiServiceResponse.mainResult?.usage) {
			// Give the usage promise a short time to resolve
			await TimeoutManager.withSoftTimeout(
				aiServiceResponse.mainResult.usage,
				1000,
				undefined
			);
		}
		displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
	}
}

/**
 * Display non-streaming CLI output
 * @param {Object} params
 */
export function displayNonStreamingCliOutput({
	processedTasks,
	research,
	finalTasks,
	tasksPath,
	aiServiceResponse
}) {
	// The progress line already said how many tasks; say where they went
	// and what to do next
	console.log(
		ui.formatParsePrdSaved({
			tasksPath: path.relative(process.cwd(), tasksPath) || tasksPath,
			added: processedTasks.length,
			total: finalTasks.length,
			research
		})
	);

	if (aiServiceResponse?.telemetryData) {
		displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
	}
}
