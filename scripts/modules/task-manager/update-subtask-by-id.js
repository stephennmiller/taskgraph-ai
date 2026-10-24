import { ui } from '@tm/cli';
import {
	stripTerminalControls,
	withoutReservedMetadata,
	getPromptManager
} from '@tm/core';
import fs from 'fs';
import path from 'path';
import { generateTextService } from '../ai-services-unified.js';
import { getDebugFlag, hasCodebaseAnalysis } from '../config-manager.js';
import {
	displayAiUsageSummary,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';
import {
	log as consoleLog,
	findProjectRoot,
	flattenTasksWithSubtasks,
	isSilentMode,
	readJSON,
	truncate,
	writeJSON
} from '../utils.js';

/**
 * Update a subtask by appending additional timestamped information using the unified AI service.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} subtaskId - ID of the subtask to update in format "parentId.subtaskId"
 * @param {string} prompt - Prompt for generating additional information
 * @param {boolean} [useResearch=false] - Whether to use the research AI role.
 * @param {Object} context - Context object containing session and mcpLog.
 * @param {Object} [context.session] - Session object from MCP server.
 * @param {Object} [context.mcpLog] - MCP logger object.
 * @param {string} [context.projectRoot] - Project root path (needed for AI service key resolution).
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json'). Automatically 'json' if mcpLog is present.
 * @returns {Promise<Object|null>} - The updated subtask or null if update failed.
 */
async function updateSubtaskById(
	tasksPath,
	subtaskId,
	prompt,
	useResearch = false,
	context = {},
	outputFormat = context.mcpLog ? 'json' : 'text'
) {
	const { session, mcpLog, projectRoot: providedProjectRoot, tag } = context;
	// dependencySources is reserved for dependency provenance
	const metadata = withoutReservedMetadata(context.metadata);
	const logFn = mcpLog || consoleLog;
	const isMCP = !!mcpLog;

	// Report helper
	const report = (level, ...args) => {
		if (isMCP) {
			if (typeof logFn[level] === 'function') logFn[level](...args);
			else logFn.info(...args);
		} else if (!isSilentMode()) {
			logFn(level, ...args);
		}
	};

	let loadingIndicator = null;

	try {
		report('debug', `Updating subtask ${subtaskId} with prompt: "${prompt}"`);

		// Basic validation - ID must be present
		if (!subtaskId || typeof subtaskId !== 'string') {
			throw new Error('Subtask ID cannot be empty.');
		}
		// Allow metadata-only updates (no prompt required if metadata is provided)
		if (
			(!prompt || typeof prompt !== 'string' || prompt.trim() === '') &&
			!metadata
		) {
			throw new Error(
				'Prompt cannot be empty unless metadata is provided. Please provide context for the subtask update or metadata to merge.'
			);
		}

		const projectRoot = providedProjectRoot || findProjectRoot();
		if (!projectRoot) {
			throw new Error('Could not determine project root directory');
		}

		// Validate the subtask ID format (must contain a dot)
		if (!subtaskId.includes('.')) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. In solo mode, subtask ID must be in format "parentId.subtaskId" (e.g., "5.2").`
			);
		}

		if (!fs.existsSync(tasksPath)) {
			throw new Error(`Tasks file not found at path: ${tasksPath}`);
		}

		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks) {
			throw new Error(
				`No valid tasks found in ${tasksPath}. The file may be corrupted or have an invalid format.`
			);
		}

		const [parentIdStr, subtaskIdStr] = subtaskId.split('.');
		const parentId = parseInt(parentIdStr, 10);
		const subtaskIdNum = parseInt(subtaskIdStr, 10);

		if (
			Number.isNaN(parentId) ||
			parentId <= 0 ||
			Number.isNaN(subtaskIdNum) ||
			subtaskIdNum <= 0
		) {
			throw new Error(
				`Invalid subtask ID format: ${subtaskId}. Both parent ID and subtask ID must be positive integers.`
			);
		}

		const parentTask = data.tasks.find((task) => task.id === parentId);
		if (!parentTask) {
			throw new Error(`Task ${parentId} not found`);
		}

		if (!parentTask.subtasks || !Array.isArray(parentTask.subtasks)) {
			throw new Error(`Parent task ${parentId} has no subtasks.`);
		}

		const subtaskIndex = parentTask.subtasks.findIndex(
			(st) => st.id === subtaskIdNum
		);
		if (subtaskIndex === -1) {
			throw new Error(`Subtask ${subtaskId} not found`);
		}

		const subtask = parentTask.subtasks[subtaskIndex];

		// --- Metadata-Only Update (Fast Path) ---
		// If only metadata is provided (no prompt), skip AI and just update metadata
		if (metadata && (!prompt || prompt.trim() === '')) {
			report('debug', `Metadata-only update for subtask ${subtaskId}`);
			// Merge new metadata with existing
			subtask.metadata = {
				...(subtask.metadata || {}),
				...metadata
			};
			parentTask.subtasks[subtaskIndex] = subtask;
			writeJSON(tasksPath, data, projectRoot, tag);
			report(
				'success',
				`Successfully updated metadata for subtask ${subtaskId}`
			);

			return {
				updatedSubtask: subtask,
				telemetryData: null,
				tagInfo: { tag }
			};
		}
		// --- End Metadata-Only Update ---

		// --- Context Gathering ---
		let gatheredContext = '';
		try {
			const contextGatherer = new ContextGatherer(projectRoot, tag);
			const allTasksFlat = flattenTasksWithSubtasks(data.tasks);
			const fuzzySearch = new FuzzyTaskSearch(allTasksFlat, 'update-subtask');
			const searchQuery = `${parentTask.title} ${subtask.title} ${prompt}`;
			const searchResults = fuzzySearch.findRelevantTasks(searchQuery, {
				maxResults: 5,
				includeSelf: true
			});
			const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

			const finalTaskIds = [
				...new Set([subtaskId.toString(), ...relevantTaskIds])
			];

			if (finalTaskIds.length > 0) {
				const contextResult = await contextGatherer.gather({
					tasks: finalTaskIds,
					format: 'research'
				});
				gatheredContext = contextResult.context || '';
			}
		} catch (contextError) {
			report('warn', `Could not gather context: ${contextError.message}`);
		}
		// --- End Context Gathering ---

		if (outputFormat === 'text') {
			loadingIndicator = startLoadingIndicator(
				`Updating subtask ${subtaskId}: ${truncate(stripTerminalControls(String(subtask.title ?? ''), { singleLine: true }), 50)}${useResearch ? ' (with research)' : ''}`
			);
		}

		let generatedContentString = '';
		let aiServiceResponse = null;

		try {
			const parentContext = {
				id: parentTask.id,
				title: parentTask.title
			};
			const prevSubtask =
				subtaskIndex > 0
					? {
							id: `${parentTask.id}.${parentTask.subtasks[subtaskIndex - 1].id}`,
							title: parentTask.subtasks[subtaskIndex - 1].title,
							status: parentTask.subtasks[subtaskIndex - 1].status
						}
					: undefined;
			const nextSubtask =
				subtaskIndex < parentTask.subtasks.length - 1
					? {
							id: `${parentTask.id}.${parentTask.subtasks[subtaskIndex + 1].id}`,
							title: parentTask.subtasks[subtaskIndex + 1].title,
							status: parentTask.subtasks[subtaskIndex + 1].status
						}
					: undefined;

			// Build prompts using PromptManager
			const promptManager = getPromptManager();

			const promptParams = {
				parentTask: parentContext,
				prevSubtask: prevSubtask,
				nextSubtask: nextSubtask,
				currentDetails: subtask.details || '(No existing details)',
				updatePrompt: prompt,
				useResearch: useResearch,
				gatheredContext: gatheredContext || '',
				hasCodebaseAnalysis: hasCodebaseAnalysis(
					useResearch,
					projectRoot,
					session
				),
				projectRoot: projectRoot
			};

			const variantKey = useResearch ? 'research' : 'default';
			const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
				'update-subtask',
				promptParams,
				variantKey
			);

			const role = useResearch ? 'research' : 'main';
			report('debug', `Using AI text service with role: ${role}`);

			aiServiceResponse = await generateTextService({
				prompt: userPrompt,
				systemPrompt: systemPrompt,
				role,
				session,
				projectRoot,
				commandName: 'update-subtask',
				outputType: isMCP ? 'mcp' : 'cli'
			});

			if (
				aiServiceResponse &&
				aiServiceResponse.mainResult &&
				typeof aiServiceResponse.mainResult === 'string'
			) {
				generatedContentString = aiServiceResponse.mainResult;
			} else {
				generatedContentString = '';
				// The CLI prints one "Nothing added" line below instead
				if (outputFormat !== 'text') {
					report(
						'warn',
						'AI service response did not contain expected text string.'
					);
				}
			}

			if (outputFormat === 'text' && loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
		} catch (aiError) {
			if (outputFormat === 'text' && loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
			throw aiError;
		}

		if (generatedContentString && generatedContentString.trim()) {
			// Check if the string is not empty
			const timestamp = new Date().toISOString();
			const formattedBlock = `<info added on ${timestamp}>\n${generatedContentString.trim()}\n</info added on ${timestamp}>`;

			subtask.details =
				(subtask.details ? subtask.details + '\n' : '') + formattedBlock;
		} else if (outputFormat !== 'text') {
			// The CLI line below says so
			report(
				'warn',
				'AI response was empty or whitespace after trimming. Original details remain unchanged.'
			);
		}

		const updatedSubtask = parentTask.subtasks[subtaskIndex];

		// Merge metadata if provided (preserve existing metadata)
		if (metadata) {
			updatedSubtask.metadata = {
				...(updatedSubtask.metadata || {}),
				...metadata
			};
		}

		if (outputFormat === 'text' && getDebugFlag(session)) {
			console.log(
				'>>> DEBUG: Subtask details AFTER AI update:',
				updatedSubtask.details
			);
		}

		if (updatedSubtask.description) {
			if (prompt.length < 100) {
				if (outputFormat === 'text' && getDebugFlag(session)) {
					console.log(
						'>>> DEBUG: Subtask description BEFORE append:',
						updatedSubtask.description
					);
				}
				updatedSubtask.description += ` [Updated: ${new Date().toLocaleDateString()}]`;
				if (outputFormat === 'text' && getDebugFlag(session)) {
					console.log(
						'>>> DEBUG: Subtask description AFTER append:',
						updatedSubtask.description
					);
				}
			}
		}

		if (outputFormat === 'text' && getDebugFlag(session)) {
			console.log('>>> DEBUG: About to call writeJSON with updated data...');
		}
		writeJSON(tasksPath, data, projectRoot, tag);
		if (outputFormat === 'text' && getDebugFlag(session)) {
			console.log('>>> DEBUG: writeJSON call completed.');
		}

		report('debug', `Successfully updated subtask ${subtaskId}`);
		// Updated  function call to make sure if uncommented it will generate the task files for the updated subtask based on the tag
		// await generateTaskFiles(tasksPath, path.dirname(tasksPath), {
		// 	tag: tag,
		// 	projectRoot: projectRoot
		// });

		if (outputFormat === 'text') {
			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
			console.log(
				ui.formatNotesAdded(
					{ kind: 'subtask', id: subtaskId, title: updatedSubtask.title },
					generatedContentString?.trim() ?? ''
				)
			);
		}

		if (outputFormat === 'text' && aiServiceResponse.telemetryData) {
			displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
		}

		return {
			updatedSubtask: updatedSubtask,
			telemetryData: aiServiceResponse.telemetryData,
			tagInfo: aiServiceResponse.tagInfo
		};
	} catch (error) {
		if (outputFormat === 'text' && loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
			loadingIndicator = null;
		}
		// The CLI command prints the error once (and exits non-zero), so only
		// MCP logs it here
		if (outputFormat !== 'text') {
			report('error', `Error updating subtask: ${error.message}`);
		}
		throw error;
	}
}

export default updateSubtaskById;
