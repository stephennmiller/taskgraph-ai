import { ui } from '@tm/cli';
import {
	assignMetadata,
	keepChecklistFields,
	reconcileDependencySources
} from '@tm/core';
import chalk from 'chalk';
import path from 'path';
import { COMMAND_SCHEMAS } from '../../../src/schemas/registry.js';
import { generateObjectService } from '../ai-services-unified.js';
import { getDebugFlag, hasCodebaseAnalysis } from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
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
	writeJSON
} from '../utils.js';
import { getModelConfiguration } from './models.js';

/**
 * Update tasks based on new context using the unified AI service.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} fromId - Task ID to start updating from
 * @param {string} prompt - Prompt with new context
 * @param {boolean} [useResearch=false] - Whether to use the research AI role.
 * @param {Object} context - Context object containing session and mcpLog.
 * @param {Object} [context.session] - Session object from MCP server.
 * @param {Object} [context.mcpLog] - MCP logger object.
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json').
 */
async function updateTasks(
	tasksPath,
	fromId,
	prompt,
	useResearch = false,
	context = {},
	outputFormat = 'text' // Default to text for CLI
) {
	const { session, mcpLog, projectRoot: providedProjectRoot, tag } = context;
	// Use mcpLog if available, otherwise use the imported consoleLog function
	const logFn = mcpLog || consoleLog;
	// Flag to easily check which logger type we have
	const isMCP = !!mcpLog;

	if (isMCP)
		logFn.debug(`updateTasks called with context: session=${!!session}`);
	else logFn('debug', 'updateTasks called');

	try {
		if (isMCP) logFn.debug(`Updating tasks from ID ${fromId}`);
		else
			logFn(
				'debug',
				`Updating tasks from ID ${fromId} with prompt: "${prompt}"`
			);

		// Determine project root
		const projectRoot = providedProjectRoot || findProjectRoot();
		if (!projectRoot) {
			throw new Error('Could not determine project root directory');
		}

		// --- Task Loading/Filtering (Updated to pass projectRoot and tag) ---
		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks)
			throw new Error(`No valid tasks found in ${tasksPath}`);
		const tasksToUpdate = data.tasks.filter(
			(task) => task.id >= fromId && task.status !== 'done'
		);
		if (tasksToUpdate.length === 0) {
			if (isMCP)
				logFn.info(`No tasks to update (ID >= ${fromId} and not 'done').`);
			else if (outputFormat === 'text')
				console.log(ui.formatNothingToUpdate(fromId));
			else
				logFn('info', `No tasks to update (ID >= ${fromId} and not 'done').`);
			return; // Nothing to do
		}
		// --- End Task Loading/Filtering ---

		// --- Context Gathering ---
		let gatheredContext = '';
		try {
			const contextGatherer = new ContextGatherer(projectRoot, tag);
			const allTasksFlat = flattenTasksWithSubtasks(data.tasks);
			const fuzzySearch = new FuzzyTaskSearch(allTasksFlat, 'update');
			const searchResults = fuzzySearch.findRelevantTasks(prompt, {
				maxResults: 5,
				includeSelf: true
			});
			const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

			const tasksToUpdateIds = tasksToUpdate.map((t) => t.id.toString());
			const finalTaskIds = [
				...new Set([...tasksToUpdateIds, ...relevantTaskIds])
			];

			if (finalTaskIds.length > 0) {
				const contextResult = await contextGatherer.gather({
					tasks: finalTaskIds,
					format: 'research'
				});
				gatheredContext = contextResult.context || '';
			}
		} catch (contextError) {
			logFn(
				'warn',
				`Could not gather additional context: ${contextError.message}`
			);
		}
		// --- End Context Gathering ---

		// --- Build Prompts (Using PromptManager) ---
		// Load prompts using PromptManager
		const promptManager = getPromptManager();
		const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
			'update-tasks',
			{
				tasks: tasksToUpdate,
				updatePrompt: prompt,
				useResearch,
				projectContext: gatheredContext,
				hasCodebaseAnalysis: hasCodebaseAnalysis(
					useResearch,
					projectRoot,
					session
				),
				projectRoot: projectRoot
			}
		);
		// --- End Build Prompts ---

		// --- AI Call ---
		let loadingIndicator = null;
		let aiServiceResponse = null;

		if (!isMCP && outputFormat === 'text') {
			// The result lists the tasks, so the spinner only counts them
			loadingIndicator = startLoadingIndicator(
				`Updating ${tasksToUpdate.length} ${tasksToUpdate.length === 1 ? 'task' : 'tasks'} from ID ${fromId}${useResearch ? ' (with research)' : ''}…`
			);
		}

		try {
			// Determine role based on research flag
			const serviceRole = useResearch ? 'research' : 'main';

			// Call the unified AI service with generateObject
			aiServiceResponse = await generateObjectService({
				role: serviceRole,
				session: session,
				projectRoot: projectRoot,
				systemPrompt: systemPrompt,
				prompt: userPrompt,
				schema: COMMAND_SCHEMAS['update-tasks'],
				objectName: 'tasks',
				commandName: 'update-tasks',
				outputType: isMCP ? 'mcp' : 'cli'
			});

			if (loadingIndicator)
				stopLoadingIndicator(loadingIndicator, 'AI update complete.');

			// With generateObject, we get structured data directly
			const parsedUpdatedTasks = aiServiceResponse.mainResult.tasks.map(
				(task) => ({
					...task,
					dependencies: task.dependencies ?? [],
					priority: task.priority ?? null,
					details: task.details ?? null,
					testStrategy: task.testStrategy ?? null,
					subtasks: task.subtasks
						? task.subtasks.map((subtask) => ({
								...subtask,
								dependencies: subtask.dependencies ?? [],
								status: subtask.status ?? 'pending',
								testStrategy: subtask.testStrategy ?? null
							}))
						: null
				})
			);

			// --- Update Tasks Data (Updated writeJSON call) ---
			if (!Array.isArray(parsedUpdatedTasks)) {
				// Should be caught by parser, but extra check
				throw new Error(
					'Parsed AI response for updated tasks was not an array.'
				);
			}
			if (isMCP)
				logFn.info(
					`Received ${parsedUpdatedTasks.length} updated tasks from AI.`
				);
			else
				logFn(
					'debug',
					`Received ${parsedUpdatedTasks.length} updated tasks from AI.`
				);
			// Create a map for efficient lookup
			const updatedTasksMap = new Map(
				parsedUpdatedTasks.map((task) => [task.id, task])
			);

			// The model may return tasks we never sent (finished ones, or ones before
			// --from); only the tasks that were sent may change
			const sentIds = new Set(tasksToUpdate.map((t) => t.id));
			let actualUpdateCount = 0;
			const appliedTasks = [];
			data.tasks.forEach((task, index) => {
				if (sentIds.has(task.id) && updatedTasksMap.has(task.id)) {
					const updatedTask = updatedTasksMap.get(task.id);
					// Merge the updated task with the existing one to preserve fields like subtasks
					const merged = {
						...task, // Keep all existing fields
						...updatedTask, // Override with updated fields
						// Keep the existing subtasks unless the AI sent a replacement
						subtasks:
							updatedTask.subtasks != null
								? updatedTask.subtasks
								: task.subtasks
					};
					// The schema makes the model emit null for fields it has nothing to
					// say about; that must not erase what the task already holds
					for (const field of ['priority', 'details', 'testStrategy']) {
						if (updatedTask[field] == null) merged[field] = task[field];
					}
					// Dependencies the AI added are recorded as inferred; earlier marks stay
					assignMetadata(merged, reconcileDependencySources(merged, task));
					if (Array.isArray(merged.subtasks)) {
						// The AI returns subtasks without metadata; restore the one
						// matched by id (user metadata and dependency marks) and
						// record any dependency the AI added as inferred.
						merged.subtasks = merged.subtasks.map((subtask) => {
							const original = task.subtasks?.find(
								(st) => String(st.id) === String(subtask.id)
							);
							const restored = { ...subtask };
							delete restored.metadata;
							if (restored.testStrategy == null && original) {
								restored.testStrategy = original.testStrategy;
							}
							// The AI schema has no criteria; keep the stored checklist
							keepChecklistFields(restored, original);
							assignMetadata(
								restored,
								reconcileDependencySources(subtask, original, task.id)
							);
							return restored;
						});
					}
					data.tasks[index] = merged;
					actualUpdateCount++;
					appliedTasks.push(merged);
				}
			});
			if (isMCP)
				logFn.info(
					`Applied updates to ${actualUpdateCount} tasks in the dataset.`
				);
			else
				logFn(
					'debug',
					`Applied updates to ${actualUpdateCount} tasks in the dataset.`
				);

			// Fix: Pass projectRoot and currentTag to writeJSON
			writeJSON(tasksPath, data, projectRoot, tag);
			if (isMCP)
				logFn.info(
					`Successfully updated ${actualUpdateCount} tasks in ${tasksPath}`
				);
			else if (outputFormat === 'text')
				console.log(ui.formatTasksUpdated(appliedTasks));
			// await generateTaskFiles(tasksPath, path.dirname(tasksPath));

			if (outputFormat === 'text' && aiServiceResponse.telemetryData) {
				displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
			}

			return {
				success: true,
				updatedTasks: parsedUpdatedTasks,
				telemetryData: aiServiceResponse.telemetryData,
				tagInfo: aiServiceResponse.tagInfo
			};
		} catch (error) {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			if (isMCP) logFn.error(`Error during AI service call: ${error.message}`);
			else logFn('error', `Error during AI service call: ${error.message}`);
			if (error.message.includes('API key')) {
				if (isMCP)
					logFn.error(
						'Please ensure API keys are configured correctly in .env or mcp.json.'
					);
				else
					logFn(
						'error',
						'Please ensure API keys are configured correctly in .env or mcp.json.'
					);
			}
			throw error;
		} finally {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
		}
	} catch (error) {
		// --- General Error Handling (Unchanged) ---
		if (isMCP) logFn.error(`Error updating tasks: ${error.message}`);
		else logFn('error', `Error updating tasks: ${error.message}`);
		if (outputFormat === 'text') {
			console.error(chalk.red(`Error: ${error.message}`));
			if (getDebugFlag(session)) {
				console.error(error);
			}
			process.exit(1);
		} else {
			throw error; // Re-throw for MCP/programmatic callers
		}
		// --- End General Error Handling ---
	}
}

export default updateTasks;
