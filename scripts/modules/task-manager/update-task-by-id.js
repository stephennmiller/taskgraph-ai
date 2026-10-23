import { ui } from '@tm/cli';
import {
	assignMetadata,
	cleanGeneratedSubtaskDependencies,
	keepStoredFields,
	reconcileDependencySources,
	stripTerminalControls,
	withoutReservedMetadata
} from '@tm/core';
import fs from 'fs';
import { COMMAND_SCHEMAS } from '../../../src/schemas/registry.js';
import {
	generateObjectService,
	generateTextService
} from '../ai-services-unified.js';
import { createBridgeLogger } from '../bridge-utils.js';
import { hasCodebaseAnalysis } from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import {
	displayAiUsageSummary,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';
import {
	findProjectRoot,
	flattenTasksWithSubtasks,
	readJSON,
	truncate,
	writeJSON
} from '../utils.js';

/**
 * Update a task by ID with new information using the unified AI service.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string|number} taskId - ID of the task to update (supports numeric and subtask IDs like 1.2)
 * @param {string} prompt - Prompt for generating updated task information
 * @param {boolean} [useResearch=false] - Whether to use the research AI role.
 * @param {Object} context - Context object containing session and mcpLog.
 * @param {Object} [context.session] - Session object from MCP server.
 * @param {Object} [context.mcpLog] - MCP logger object.
 * @param {string} [context.projectRoot] - Project root path.
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json').
 * @param {boolean} [appendMode=false] - If true, append to details instead of full update.
 * @returns {Promise<Object|null>} - The updated task or null if update failed.
 */
async function updateTaskById(
	tasksPath,
	taskId,
	prompt,
	useResearch = false,
	context = {},
	outputFormat = 'text',
	appendMode = false
) {
	const { session, mcpLog, projectRoot: providedProjectRoot, tag } = context;
	// dependencySources is reserved for dependency provenance
	const metadata = withoutReservedMetadata(context.metadata);
	const { report, isMCP } = createBridgeLogger(mcpLog, session);

	try {
		report('debug', `Updating single task ${taskId} with prompt: "${prompt}"`);

		// --- Input Validations ---
		// Note: taskId can be a number (1) or a string with a dot (1.2)
		// So we don't validate it as strictly anymore
		if (taskId === null || taskId === undefined || String(taskId).trim() === '')
			throw new Error('Task ID cannot be empty.');

		// Allow metadata-only updates (prompt can be empty if metadata is provided)
		if (
			(!prompt || typeof prompt !== 'string' || prompt.trim() === '') &&
			!metadata
		) {
			throw new Error(
				'Prompt cannot be empty unless metadata is provided for update.'
			);
		}

		// Determine project root first (needed for API key checks)
		const projectRoot = providedProjectRoot || findProjectRoot();
		if (!projectRoot) {
			throw new Error('Could not determine project root directory');
		}

		// Ensure the tasks file exists
		if (!fs.existsSync(tasksPath))
			throw new Error(`Tasks file not found: ${tasksPath}`);
		// --- End Input Validations ---

		// --- Task Loading and Status Check (Keep existing) ---
		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks)
			throw new Error(`No valid tasks found in ${tasksPath}.`);
		// A strict numeric task ID is required
		const idStr = String(taskId).trim();
		if (!/^\d+$/.test(idStr)) {
			throw new Error(
				'taskId must be a positive integer. ' +
					'Use update-subtask-by-id for IDs like "1.2".'
			);
		}
		const numericTaskId = Number(idStr);
		const taskIndex = data.tasks.findIndex((task) => task.id === numericTaskId);
		if (taskIndex === -1) {
			throw new Error(`Task ${numericTaskId} not found`);
		}
		const taskToUpdate = data.tasks[taskIndex];
		if (taskToUpdate.status === 'done') {
			// The CLI command explains this once, with the fix; MCP gets a warning
			if (outputFormat !== 'text') {
				report(
					'warn',
					`Task ${taskId} is already marked as done and cannot be updated`
				);
			}
			return null;
		}
		// --- End Task Loading ---

		// --- Metadata-Only Update (Fast Path) ---
		// If only metadata is provided (no prompt), skip AI and just update metadata
		if (metadata && (!prompt || prompt.trim() === '')) {
			report('debug', `Metadata-only update for task ${taskId}`);
			// Merge new metadata with existing
			taskToUpdate.metadata = {
				...(taskToUpdate.metadata || {}),
				...metadata
			};
			data.tasks[taskIndex] = taskToUpdate;
			writeJSON(tasksPath, data, projectRoot, tag);
			report('success', `Successfully updated metadata for task ${taskId}`);

			return {
				updatedTask: taskToUpdate,
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
			const fuzzySearch = new FuzzyTaskSearch(allTasksFlat, 'update-task');
			const searchQuery = `${taskToUpdate.title} ${taskToUpdate.description} ${prompt}`;
			const searchResults = fuzzySearch.findRelevantTasks(searchQuery, {
				maxResults: 5,
				includeSelf: true
			});
			const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

			const finalTaskIds = [
				...new Set([taskId.toString(), ...relevantTaskIds])
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

		// --- Build Prompts using PromptManager ---
		const promptManager = getPromptManager();

		const promptParams = {
			task: taskToUpdate,
			taskJson: JSON.stringify(taskToUpdate, null, 2),
			updatePrompt: prompt,
			appendMode: appendMode,
			useResearch: useResearch,
			currentDetails: taskToUpdate.details || '(No existing details)',
			gatheredContext: gatheredContext || '',
			hasCodebaseAnalysis: hasCodebaseAnalysis(
				useResearch,
				projectRoot,
				session
			),
			projectRoot: projectRoot
		};

		const variantKey = appendMode
			? 'append'
			: useResearch
				? 'research'
				: 'default';

		report(
			'debug',
			`Loading prompt template with variant: ${variantKey}, appendMode: ${appendMode}, useResearch: ${useResearch}`
		);

		let systemPrompt;
		let userPrompt;
		try {
			const promptResult = promptManager.loadPrompt(
				'update-task',
				promptParams,
				variantKey
			);
			report(
				'debug',
				`Prompt result type: ${typeof promptResult}, keys: ${promptResult ? Object.keys(promptResult).join(', ') : 'null'}`
			);

			// Extract prompts - loadPrompt returns { systemPrompt, userPrompt, metadata }
			systemPrompt = promptResult.systemPrompt;
			userPrompt = promptResult.userPrompt;

			report(
				'debug',
				`Loaded prompts - systemPrompt length: ${systemPrompt?.length}, userPrompt length: ${userPrompt?.length}`
			);
		} catch (error) {
			report('error', `Failed to load prompt template: ${error.message}`);
			throw new Error(`Failed to load prompt template: ${error.message}`);
		}

		// If prompts are still not set, throw an error
		if (!systemPrompt || !userPrompt) {
			throw new Error(
				`Failed to load prompts: systemPrompt=${!!systemPrompt}, userPrompt=${!!userPrompt}`
			);
		}
		// --- End Build Prompts ---

		let loadingIndicator = null;
		let aiServiceResponse = null;

		if (!isMCP && outputFormat === 'text') {
			// The spinner names the task, so no header box is needed above it
			loadingIndicator = startLoadingIndicator(
				`Updating task ${taskId}: ${truncate(stripTerminalControls(String(taskToUpdate.title ?? ''), { singleLine: true }), 50)}${useResearch ? ' (with research)' : ''}`
			);
		}

		try {
			const serviceRole = useResearch ? 'research' : 'main';

			if (appendMode) {
				// Append mode still uses generateTextService since it returns plain text
				aiServiceResponse = await generateTextService({
					role: serviceRole,
					session: session,
					projectRoot: projectRoot,
					systemPrompt: systemPrompt,
					prompt: userPrompt,
					commandName: 'update-task',
					outputType: isMCP ? 'mcp' : 'cli'
				});
			} else {
				// Full update mode uses generateObjectService for structured output
				aiServiceResponse = await generateObjectService({
					role: serviceRole,
					session: session,
					projectRoot: projectRoot,
					systemPrompt: systemPrompt,
					prompt: userPrompt,
					schema: COMMAND_SCHEMAS['update-task-by-id'],
					objectName: 'task',
					commandName: 'update-task',
					outputType: isMCP ? 'mcp' : 'cli'
				});
			}

			if (loadingIndicator)
				stopLoadingIndicator(loadingIndicator, 'AI update complete.');

			if (appendMode) {
				// Append mode: handle as plain text
				const generatedContentString = aiServiceResponse.mainResult;
				const addedNotes =
					typeof generatedContentString === 'string'
						? generatedContentString.trim()
						: '';

				if (addedNotes) {
					const timestamp = new Date().toISOString();
					const formattedBlock = `<info added on ${timestamp}>\n${addedNotes}\n</info added on ${timestamp}>`;

					// Append to task details
					taskToUpdate.details =
						(taskToUpdate.details ? taskToUpdate.details + '\n' : '') +
						formattedBlock;
				} else if (outputFormat !== 'text') {
					// The CLI line below says so
					report(
						'warn',
						'AI response was empty or whitespace after trimming. Original details remain unchanged.'
					);
				}

				// Update description with timestamp if prompt is short
				if (prompt.length < 100) {
					if (taskToUpdate.description) {
						taskToUpdate.description += ` [Updated: ${new Date().toLocaleDateString()}]`;
					}
				}

				// Merge metadata if provided
				if (metadata) {
					taskToUpdate.metadata = {
						...(taskToUpdate.metadata || {}),
						...metadata
					};
				}

				// Write the updated task back to file
				data.tasks[taskIndex] = taskToUpdate;
				writeJSON(tasksPath, data, projectRoot, tag);
				report('debug', `Successfully appended to task ${taskId}`);

				// Say what was added, once
				if (outputFormat === 'text') {
					console.log(
						ui.formatNotesAdded(
							{ kind: 'task', id: taskId, title: taskToUpdate.title },
							addedNotes
						)
					);
				}

				// Display AI usage telemetry for CLI users
				if (outputFormat === 'text' && aiServiceResponse.telemetryData) {
					displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
				}

				// Return the updated task
				return {
					updatedTask: taskToUpdate,
					telemetryData: aiServiceResponse.telemetryData,
					tagInfo: aiServiceResponse.tagInfo
				};
			}

			// Full update mode: Use structured data directly
			const aiTask = aiServiceResponse.mainResult?.task;
			if (!aiTask || typeof aiTask !== 'object')
				throw new Error('Received invalid task object from AI.');

			const updatedTask = {
				...aiTask,
				dependencies: aiTask.dependencies ?? [],
				priority: aiTask.priority ?? null,
				details: aiTask.details ?? null,
				testStrategy: aiTask.testStrategy ?? null
			};
			if (!updatedTask.title || !updatedTask.description)
				throw new Error('Updated task missing required fields.');
			// Preserve ID if AI changed it
			if (updatedTask.id !== taskId) {
				// Routine: the model often renumbers; restoring it is not the user's concern
				report('debug', `AI changed task ID. Restoring original ID ${taskId}.`);
				updatedTask.id = taskId;
			}
			// Preserve status if AI changed it
			if (
				updatedTask.status !== taskToUpdate.status &&
				!prompt.toLowerCase().includes('status')
			) {
				report(
					'warn',
					`AI changed task status. Restoring original status '${taskToUpdate.status}'.`
				);
				updatedTask.status = taskToUpdate.status;
			}
			// Fix subtask IDs if they exist (ensure they are numeric and sequential)
			if (updatedTask.subtasks && Array.isArray(updatedTask.subtasks)) {
				let currentSubtaskId = 1;
				updatedTask.subtasks = updatedTask.subtasks.map((subtask) => {
					// Find the original subtask to keep the fields the AI can't return
					// Use type-coerced ID matching (AI may return string IDs vs numeric)
					// Also match by title as fallback (subtask titles are typically unique)
					const originalSubtask = taskToUpdate.subtasks?.find(
						(st) =>
							String(st.id) === String(subtask.id) ||
							(subtask.title && st.title === subtask.title)
					);
					// Fix AI-generated subtask IDs that might be strings or use parent ID as prefix
					const correctedSubtask = {
						...subtask,
						id: currentSubtaskId, // Override AI-generated ID with correct sequential ID
						// A number is an earlier sibling; a string is a task or subtask
						dependencies: cleanGeneratedSubtaskDependencies(
							subtask.dependencies,
							taskId,
							currentSubtaskId
						),
						status: subtask.status || 'pending',
						testStrategy: subtask.testStrategy ?? null
					};
					keepStoredFields(correctedSubtask, originalSubtask);
					currentSubtaskId++;
					// Dependencies the AI added are inferred; earlier marks stay.
					// Known limit: subtasks are renumbered above without remapping their
					// sibling dependencies, so when the AI reorders subtasks a sibling
					// dependency compares by its new number and can change source.
					assignMetadata(
						correctedSubtask,
						reconcileDependencySources(
							correctedSubtask,
							originalSubtask,
							taskToUpdate.id
						)
					);
					return correctedSubtask;
				});
				report(
					'debug',
					`Fixed ${updatedTask.subtasks.length} subtask IDs to be sequential numeric IDs.`
				);
			}

			// Preserve completed subtasks (Keep existing logic)
			if (taskToUpdate.subtasks?.length > 0) {
				if (!updatedTask.subtasks) {
					report(
						'warn',
						'Subtasks removed by AI. Restoring original subtasks.'
					);
					updatedTask.subtasks = taskToUpdate.subtasks;
				} else {
					const completedOriginal = taskToUpdate.subtasks.filter(
						(st) => st.status === 'done'
					);
					completedOriginal.forEach((compSub) => {
						const updatedSub = updatedTask.subtasks.find(
							(st) => st.id === compSub.id
						);
						if (
							!updatedSub ||
							JSON.stringify(updatedSub) !== JSON.stringify(compSub)
						) {
							report(
								'warn',
								`Completed subtask ${compSub.id} was modified or removed. Restoring.`
							);
							// Remove potentially modified version
							updatedTask.subtasks = updatedTask.subtasks.filter(
								(st) => st.id !== compSub.id
							);
							// Add back original
							updatedTask.subtasks.push(compSub);
						}
					});
					// Deduplicate just in case
					const subtaskIds = new Set();
					updatedTask.subtasks = updatedTask.subtasks.filter((st) => {
						if (!subtaskIds.has(st.id)) {
							subtaskIds.add(st.id);
							return true;
						}
						report('warn', `Duplicate subtask ID ${st.id} removed.`);
						return false;
					});
				}
			}
			// --- End Task Validation/Correction ---

			// The AI schema has only some fields and sends null for the ones it has
			// nothing to say about; keep the stored value of each (GitHub link,
			// tags, details, criteria and the done gate they carry, ...)
			keepStoredFields(updatedTask, taskToUpdate);

			// --- Preserve and Merge Metadata ---
			// Stored metadata plus the user's, with dependencies the AI added
			// recorded as inferred (earlier marks stay)
			const dependencyMetadata = reconcileDependencySources(
				updatedTask,
				taskToUpdate
			);
			assignMetadata(
				updatedTask,
				dependencyMetadata || metadata
					? { ...(dependencyMetadata || {}), ...(metadata || {}) }
					: undefined
			);
			// --- End Preserve and Merge Metadata ---

			// --- Update Task Data (Keep existing) ---
			data.tasks[taskIndex] = updatedTask;
			// --- End Update Task Data ---

			// --- Write File and Generate (Unchanged) ---
			writeJSON(tasksPath, data, projectRoot, tag);
			if (outputFormat === 'text') {
				console.log(ui.formatTaskUpdated(updatedTask));
			} else {
				report('success', `Updated task ${taskId}`);
			}
			// await generateTaskFiles(tasksPath, path.dirname(tasksPath));
			// --- End Write File ---

			// --- Display CLI Telemetry ---
			if (outputFormat === 'text' && aiServiceResponse.telemetryData) {
				displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli'); // <<< ADD display
			}

			// --- Return Success with Telemetry ---
			return {
				updatedTask: updatedTask, // Return the updated task object
				telemetryData: aiServiceResponse.telemetryData, // <<< ADD telemetryData
				tagInfo: aiServiceResponse.tagInfo
			};
		} catch (error) {
			// Catch errors from generateTextService
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			throw error; // The outer catch reports it
		}
	} catch (error) {
		// General error catch
		// --- General Error Handling (Keep existing) ---
		// The CLI command prints the error once, so only MCP logs it here
		if (outputFormat !== 'text') {
			report('error', `Error updating task: ${error.message}`);
		}
		throw error;
		// --- End General Error Handling ---
	}
}

export default updateTaskById;
