import { ui } from '@tm/cli';
import {
	assignMetadata,
	mergeNewTaskDependencies,
	nextTaskId,
	normalizeAcceptanceCriteria,
	readArchivedIdsSync,
	reconcileDependencySources,
	setTaskLink,
	getOwnKey
} from '@tm/core';
import Fuse from 'fuse.js'; // Import Fuse.js for advanced fuzzy search
import path from 'path';
import {
	DEFAULT_TASK_PRIORITY,
	isValidTaskPriority,
	normalizeTaskPriority,
	TASK_PRIORITY_OPTIONS
} from '../../../src/constants/task-priority.js';
import { COMMAND_SCHEMAS } from '../../../src/schemas/registry.js';
import { generateObjectService } from '../ai-services-unified.js';
import { getDefaultPriority, hasCodebaseAnalysis } from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import {
	displayAiUsageSummary,
	failLoadingIndicator,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import ContextGatherer from '../utils/contextGatherer.js';
import {
	log as consoleLog,
	ensureTagMetadata,
	isSilentMode,
	markMigrationForNotice,
	performCompleteTagMigration,
	readJSON
} from '../utils.js';
import { updateTagTasks } from '../utils/update-tag-tasks.js';
import taskExists from './task-exists.js';

/** How many tasks matching the prompt the AI is shown as context */
const MAX_RELATED_TASKS = 10;

/**
 * The task `--discovered-from` names, as a full ID ("3" or "3.2"). Checked
 * before any AI call so a typo costs nothing.
 * @param {string|number|undefined} id
 * @param {Array} tasks - Tasks of the tag the new task goes in
 * @returns {string|undefined}
 */
function resolveDiscoveredFrom(id, tasks) {
	if (id === undefined || id === null || id === '') return undefined;
	const text = String(id).trim();
	const fail = (message) =>
		Object.assign(new Error(message), {
			hint: 'Run `taskgraph list` to see task IDs'
		});
	if (!/^\d+(\.\d+)?$/.test(text)) {
		throw fail(`"${text}" isn't a task ID`);
	}
	const fullId = text
		.split('.')
		.map((part) => String(parseInt(part, 10)))
		.join('.');
	if (!taskExists(tasks, fullId)) {
		throw fail(`Task ${fullId} doesn't exist`);
	}
	return fullId;
}

/**
 * Add a new task using AI
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {string} prompt - Description of the task to add (required for AI-driven creation)
 * @param {Array} dependencies - Task dependencies
 * @param {string} priority - Task priority
 * @param {function} reportProgress - Function to report progress to MCP server (optional)
 * @param {Object} mcpLog - MCP logger object (optional)
 * @param {Object} session - Session object from MCP server (optional)
 * @param {string} outputFormat - Output format (text or json)
 * @param {Object} customEnv - Custom environment variables (optional) - Note: AI params override deprecated
 * @param {Object} manualTaskData - Manual task data (optional, for direct task creation without AI)
 * @param {boolean} useResearch - Whether to use the research model (passed to unified service)
 * @param {Object} [extras] - Fields the user gave alongside the prompt or manual data
 * @param {string[]} [extras.acceptanceCriteria] - Acceptance criteria, stored unchecked
 * @param {string} [extras.discoveredFrom] - Task this work was found while
 *   doing; stored as a `discovered-from` link, which never blocks
 * @param {Object} context - Context object containing session and potentially projectRoot
 * @param {string} [context.projectRoot] - Project root path (for MCP/env fallback)
 * @param {string} [context.commandName] - The name of the command being executed (for telemetry)
 * @param {string} [context.outputType] - The output type ('cli' or 'mcp', for telemetry)
 * @param {string} [context.tag] - Tag for the task (optional)
 * @returns {Promise<object>} An object containing newTaskId and telemetryData
 */
async function addTask(
	tasksPath,
	prompt,
	dependencies = [],
	priority = null,
	context = {},
	outputFormat = 'text', // Default to text for CLI
	manualTaskData = null,
	useResearch = false,
	extras = {}
) {
	const { session, mcpLog, projectRoot, commandName, outputType, tag } =
		context;
	const isMCP = !!mcpLog;

	// Create a consistent logFn object regardless of context
	const logFn = isMCP
		? mcpLog // Use MCP logger if provided
		: {
				// Create a wrapper around consoleLog for CLI
				info: (...args) => consoleLog('info', ...args),
				warn: (...args) => consoleLog('warn', ...args),
				error: (...args) => consoleLog('error', ...args),
				debug: (...args) => consoleLog('debug', ...args),
				success: (...args) => consoleLog('success', ...args)
			};

	// Validate priority - only accept high, medium, or low
	let effectivePriority =
		priority || getDefaultPriority(projectRoot) || DEFAULT_TASK_PRIORITY;

	// If priority is provided, validate and normalize it
	if (priority) {
		const normalizedPriority = normalizeTaskPriority(priority);
		if (normalizedPriority) {
			effectivePriority = normalizedPriority;
		} else {
			if (outputFormat === 'text') {
				consoleLog(
					'warn',
					`Invalid priority "${priority}". Using default priority "${DEFAULT_TASK_PRIORITY}".`
				);
			}
			effectivePriority = DEFAULT_TASK_PRIORITY;
		}
	}

	logFn.debug(
		`Adding new task with prompt: "${prompt}", Priority: ${effectivePriority}, Dependencies: ${dependencies.join(', ') || 'None'}, Research: ${useResearch}, ProjectRoot: ${projectRoot}`
	);
	if (tag) {
		logFn.debug(`Using tag context: ${tag}`);
	}

	let loadingIndicator = null;
	let aiServiceResponse = null; // To store the full response from AI service

	// Create custom reporter that checks for MCP log
	const report = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (outputFormat === 'text') {
			consoleLog(level, message);
		}
	};

	try {
		// Read the existing tasks - IMPORTANT: Read the raw data without tag resolution
		let rawData = readJSON(tasksPath, projectRoot, tag); // No tag parameter

		// Handle the case where readJSON returns resolved data with _rawTaggedData
		if (rawData && rawData._rawTaggedData) {
			// Use the raw tagged data and discard the resolved view
			rawData = rawData._rawTaggedData;
		}

		// If file doesn't exist or is invalid, create a new structure in memory
		if (!rawData) {
			report(
				'tasks.json not found or invalid. Initializing new structure.',
				'info'
			);
			rawData = {
				master: {
					tasks: [],
					metadata: {
						created: new Date().toISOString(),
						description: 'Default tasks context'
					}
				}
			};
			// Do not write the file here; it will be written later with the new task.
		}

		// Handle legacy format migration using utilities
		if (rawData && Array.isArray(rawData.tasks) && !rawData._rawTaggedData) {
			report('Legacy format detected. Migrating to tagged format...', 'info');

			// This is legacy format - migrate it to tagged format
			rawData = {
				master: {
					tasks: rawData.tasks,
					metadata: rawData.metadata || {
						created: new Date().toISOString(),
						updated: new Date().toISOString(),
						description: 'Tasks for master context'
					}
				}
			};
			// Ensure proper metadata using utility
			ensureTagMetadata(rawData.master, {
				description: 'Tasks for master context'
			});
			// Do not write the file here; it will be written later with the new task.

			// Perform complete migration (config.json, state.json)
			performCompleteTagMigration(tasksPath);
			markMigrationForNotice(tasksPath);

			report('Successfully migrated to tagged format.', 'success');
		}

		// Use the provided tag, or the current active tag, or default to 'master'
		const targetTag = tag;

		// Ensure the target tag exists
		if (!getOwnKey(rawData, targetTag)) {
			report(
				`Tag "${targetTag}" does not exist. Please create it first using the 'add-tag' command.`,
				'error'
			);
			throw new Error(`Tag "${targetTag}" not found.`);
		}

		// Ensure the target tag has a tasks array and metadata object
		if (!rawData[targetTag].tasks) {
			rawData[targetTag].tasks = [];
		}
		if (!rawData[targetTag].metadata) {
			rawData[targetTag].metadata = {
				created: new Date().toISOString(),
				updated: new Date().toISOString(),
				description: ``
			};
		}

		// The next ID *within the target tag*, above every archived ID too, so
		// an archived task's ID is never reused
		const tasksInTargetTag = rawData[targetTag].tasks;
		const discoveredFrom = resolveDiscoveredFrom(
			extras.discoveredFrom,
			tasksInTargetTag
		);
		const archived = readArchivedIdsSync(tasksPath, targetTag);
		let newTaskId = nextTaskId(
			tasksInTargetTag.map((t) => t.id),
			archived.highestId
		);

		// Dependencies resolve within the target tag only: task IDs repeat
		// across tags, so another tag's task 2 is not this tag's task 2. A
		// subtask ID such as 3.2 names that subtask
		const existingIds = tasksInTargetTag.flatMap((t) => [
			t.id,
			...(t.subtasks ?? []).map((s) => `${t.id}.${s.id}`)
		]);
		const { dependencies: explicitDependencies, missingExplicit: invalidDeps } =
			mergeNewTaskDependencies({ explicit: dependencies, existingIds });

		if (invalidDeps.length > 0) {
			report(
				`${invalidDeps.length === 1 ? 'Task' : 'Tasks'} ${invalidDeps.join(', ')} ${invalidDeps.length === 1 ? "doesn't" : "don't"} exist; adding the task without ${invalidDeps.length === 1 ? 'that dependency' : 'those dependencies'}`,
				'warn'
			);
		}

		let taskData;

		// Check if manual task data is provided
		if (manualTaskData) {
			report('Using manually provided task data', 'debug');
			taskData = manualTaskData;
			report('DEBUG: Taking MANUAL task data path.', 'debug');

			// Basic validation for manual data
			if (
				!taskData.title ||
				typeof taskData.title !== 'string' ||
				!taskData.description ||
				typeof taskData.description !== 'string'
			) {
				throw new Error(
					'Manual task data must include at least a title and description.'
				);
			}
		} else {
			report('DEBUG: Taking AI task generation path.', 'debug');
			// --- Refactored AI Interaction ---
			report(`Generating task data with AI with prompt:\n${prompt}`, 'debug');

			// --- Use the new ContextGatherer ---
			const contextGatherer = new ContextGatherer(projectRoot, tag);
			const gatherResult = await contextGatherer.gather({
				semanticQuery: prompt,
				maxSemanticResults: MAX_RELATED_TASKS,
				dependencyTasks: explicitDependencies,
				format: 'research'
			});

			const gatheredContext = gatherResult.context;
			const analysisData = gatherResult.analysisData;

			// One muted line saying which tasks the AI will see: the gatherer
			// sends only the first MAX_RELATED_TASKS of the tasks it matched
			if (outputFormat === 'text' && analysisData && !isSilentMode()) {
				const depIds = explicitDependencies.map(String);
				const contextLine = ui.formatResearchContext({
					taskIds: depIds,
					relatedTaskIds: analysisData.allRelevantTasks
						.slice(0, MAX_RELATED_TASKS)
						.map((task) => String(task.id))
						.filter((id) => !depIds.includes(id)),
					files: []
				});
				if (contextLine) console.log(contextLine);
			}

			// Add any manually provided details to the prompt for context
			let contextFromArgs = '';
			if (manualTaskData?.title)
				contextFromArgs += `\n- Suggested Title: "${manualTaskData.title}"`;
			if (manualTaskData?.description)
				contextFromArgs += `\n- Suggested Description: "${manualTaskData.description}"`;
			if (manualTaskData?.details)
				contextFromArgs += `\n- Additional Details Context: "${manualTaskData.details}"`;
			if (manualTaskData?.testStrategy)
				contextFromArgs += `\n- Additional Test Strategy Context: "${manualTaskData.testStrategy}"`;

			// Load prompts using PromptManager
			const promptManager = getPromptManager();
			const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
				'add-task',
				{
					prompt,
					newTaskId,
					existingTasks: tasksInTargetTag,
					gatheredContext,
					contextFromArgs,
					useResearch,
					priority: effectivePriority,
					dependencies: explicitDependencies,
					hasCodebaseAnalysis: hasCodebaseAnalysis(
						useResearch,
						projectRoot,
						session
					),
					projectRoot: projectRoot
				}
			);

			// Start the loading indicator - only for text mode
			if (outputFormat === 'text') {
				loadingIndicator = startLoadingIndicator(
					`Writing the new task${useResearch ? ' with research' : ''}…`
				);
			}

			try {
				const serviceRole = useResearch ? 'research' : 'main';
				report('DEBUG: Calling generateObjectService...', 'debug');

				aiServiceResponse = await generateObjectService({
					// Capture the full response
					role: serviceRole,
					session: session,
					projectRoot: projectRoot,
					schema: COMMAND_SCHEMAS['add-task'],
					objectName: 'newTaskData',
					systemPrompt: systemPrompt,
					prompt: userPrompt,
					commandName: commandName || 'add-task', // Use passed commandName or default
					outputType: outputType || (isMCP ? 'mcp' : 'cli') // Use passed outputType or derive
				});
				report('DEBUG: generateObjectService returned successfully.', 'debug');

				if (!aiServiceResponse || !aiServiceResponse.mainResult) {
					throw new Error(
						'AI service did not return the expected object structure.'
					);
				}

				// Prefer mainResult if it looks like a valid task object, otherwise try mainResult.object
				if (
					aiServiceResponse.mainResult.title &&
					aiServiceResponse.mainResult.description
				) {
					taskData = aiServiceResponse.mainResult;
				} else if (
					aiServiceResponse.mainResult.object &&
					aiServiceResponse.mainResult.object.title &&
					aiServiceResponse.mainResult.object.description
				) {
					taskData = aiServiceResponse.mainResult.object;
				} else {
					throw new Error('AI service did not return a valid task object.');
				}

				report('Successfully generated task data from AI.', 'debug');

				// The "✓ Added task N" line below is the confirmation; just clear the spinner
				if (loadingIndicator) {
					stopLoadingIndicator(loadingIndicator);
					loadingIndicator = null; // Clear it
				}
			} catch (error) {
				// Failure! Show X
				if (loadingIndicator) {
					failLoadingIndicator(loadingIndicator, 'AI generation failed');
					loadingIndicator = null;
				}
				report(
					`DEBUG: generateObjectService caught error: ${error.message}`,
					'debug'
				);
				report(`Error generating task with AI: ${error.message}`, 'error');
				throw error; // Re-throw error after logging
			} finally {
				report('DEBUG: generateObjectService finally block reached.', 'debug');
				// Clean up if somehow still running
				if (loadingIndicator) {
					stopLoadingIndicator(loadingIndicator);
				}
			}
			// --- End Refactored AI Interaction ---
		}

		// The dependencies the user passed always stay; the AI's suggestions are
		// added to them, minus any with no task in the target tag
		const merged = mergeNewTaskDependencies({
			explicit: explicitDependencies,
			suggested: taskData.dependencies,
			existingIds
		});
		if (merged.missingSuggested.length > 0) {
			report(
				'AI suggested invalid dependencies. Filtering them out...',
				'warn'
			);
		}

		// Create the new task object
		const newTask = {
			id: newTaskId,
			title: taskData.title,
			description: taskData.description,
			details: taskData.details || '',
			testStrategy: taskData.testStrategy || '',
			status: 'pending',
			dependencies: merged.dependencies,
			priority: effectivePriority,
			subtasks: [] // Initialize with empty subtasks array
		};
		const acceptanceCriteria = normalizeAcceptanceCriteria(
			extras.acceptanceCriteria
		);
		if (acceptanceCriteria.length > 0) {
			newTask.acceptanceCriteria = acceptanceCriteria;
		}

		// Dependencies the user passed stay explicit; any the AI added are inferred
		assignMetadata(
			newTask,
			reconcileDependencySources(newTask, {
				dependencies: explicitDependencies
			})
		);
		// Where the work was found: a link that never blocks the new task
		if (discoveredFrom) {
			assignMetadata(
				newTask,
				setTaskLink(newTask.metadata, discoveredFrom, 'discovered-from')
			);
		}

		report('DEBUG: Writing tasks.json...', 'debug');
		// Add the task to the CURRENT contents of the tag. The file may have
		// changed since it was read (the AI call can take a minute), so the ID
		// is checked again here.
		await updateTagTasks(
			tasksPath,
			targetTag,
			(tagData) => {
				if (tagData.tasks.some((t) => t.id === newTask.id)) {
					newTask.id = nextTaskId(
						tagData.tasks.map((t) => t.id),
						archived.highestId
					);
				}
				tagData.tasks.push(newTask);
				ensureTagMetadata(tagData, {
					description: `Tasks for ${targetTag} context`
				});
			},
			// A missing tasks file starts from the empty tag made above
			{ createWith: rawData[targetTag] }
		);
		newTaskId = newTask.id;
		report('DEBUG: tasks.json written.', 'debug');

		// Show success message - only for text output (CLI)
		if (outputFormat === 'text') {
			const same = (a) => (b) => String(a) === String(b);
			// A task or a subtask ("3.2"), in the tag the task went in
			const titleOf = (id) => {
				const [parent, sub] = String(id).split('.');
				const task = tasksInTargetTag.find((t) => same(parent)(t.id));
				return sub === undefined
					? (task?.title ?? '')
					: (task?.subtasks?.find((st) => same(sub)(st.id))?.title ?? '');
			};
			console.log(
				ui.formatTaskCreated({
					id: newTaskId,
					title: newTask.title,
					priority: newTask.priority,
					dependencies: newTask.dependencies.map((dep) => ({
						id: dep,
						title: titleOf(dep),
						addedByAi: !explicitDependencies.some(same(dep))
					})),
					discoveredFrom:
						discoveredFrom && !newTask.dependencies.some(same(discoveredFrom))
							? { id: discoveredFrom, title: titleOf(discoveredFrom) }
							: undefined
				})
			);

			// Display AI Usage Summary if telemetryData is available
			if (
				aiServiceResponse &&
				aiServiceResponse.telemetryData &&
				(outputType === 'cli' || outputType === 'text')
			) {
				displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
			}
		}

		report(
			`DEBUG: Returning new task ID: ${newTaskId} and telemetry.`,
			'debug'
		);
		return {
			newTaskId: newTaskId,
			telemetryData: aiServiceResponse ? aiServiceResponse.telemetryData : null,
			tagInfo: aiServiceResponse ? aiServiceResponse.tagInfo : null
		};
	} catch (error) {
		// Stop any loading indicator on error
		if (loadingIndicator) {
			stopLoadingIndicator(loadingIndicator);
		}

		// The CLI command prints the error once; MCP gets the log line and the
		// direct function handler formats the thrown error
		if (outputFormat !== 'text') {
			report(`Error adding task: ${error.message}`, 'error');
		}
		throw error;
	}
}

export default addTask;
