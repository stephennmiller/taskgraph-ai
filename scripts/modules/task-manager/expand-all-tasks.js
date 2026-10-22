import { ui } from '@tm/cli';
import { getDebugFlag } from '../config-manager.js';
import { displayAiUsageSummary } from '../ui.js';
import { findProjectRoot, isSilentMode, log, readJSON } from '../utils.js';
import { aggregateTelemetry } from '../utils.js';
import expandTask from './expand-task.js';

/**
 * Expand all eligible pending or in-progress tasks using the expandTask function.
 * @param {string} tasksPath - Path to the tasks.json file
 * @param {number} [numSubtasks] - Optional: Target number of subtasks per task.
 * @param {boolean} [useResearch=false] - Whether to use the research AI role.
 * @param {string} [additionalContext=''] - Optional additional context.
 * @param {boolean} [force=false] - Force expansion even if tasks already have subtasks.
 * @param {Object} context - Context object containing session and mcpLog.
 * @param {Object} [context.session] - Session object from MCP.
 * @param {Object} [context.mcpLog] - MCP logger object.
 * @param {string} [context.projectRoot] - Project root path
 * @param {string} [context.tag] - Tag for the task
 * @param {string} [context.complexityReportPath] - Path to the complexity report file
 * @param {string} [outputFormat='text'] - Output format ('text' or 'json'). MCP calls should use 'json'.
 * @returns {Promise<{success: boolean, expandedCount: number, failedCount: number, skippedCount: number, tasksToExpand: number, telemetryData: Array<Object>}>} - Result summary.
 */
async function expandAllTasks(
	tasksPath,
	numSubtasks, // Keep this signature, expandTask handles defaults
	useResearch = false,
	additionalContext = '',
	force = false, // Keep force here for the filter logic
	context = {},
	outputFormat = 'text' // Assume text default for CLI
) {
	const {
		session,
		mcpLog,
		projectRoot: providedProjectRoot,
		tag,
		complexityReportPath
	} = context;
	const isMCPCall = !!mcpLog; // Determine if called from MCP

	const projectRoot = providedProjectRoot || findProjectRoot();
	if (!projectRoot) {
		throw new Error('Could not determine project root directory');
	}

	// Use mcpLog if available, otherwise use the default console log wrapper respecting silent mode
	const logger =
		mcpLog ||
		(outputFormat === 'json'
			? {
					// Basic logger for JSON output mode
					info: (msg) => {},
					warn: (msg) => {},
					error: (msg) => console.error(`ERROR: ${msg}`), // Still log errors
					debug: (msg) => {}
				}
			: {
					// CLI logger respecting silent mode
					info: (msg) => !isSilentMode() && log('info', msg),
					warn: (msg) => !isSilentMode() && log('warn', msg),
					error: (msg) => !isSilentMode() && log('error', msg),
					debug: (msg) =>
						!isSilentMode() && getDebugFlag(session) && log('debug', msg)
				});

	// MCP clients follow progress at info; the CLI shows spinners and a
	// summary line instead, so there these are debug only
	const progress = (msg) => (isMCPCall ? logger.info(msg) : logger.debug(msg));

	let expandedCount = 0;
	let failedCount = 0;
	let skippedCount = 0;
	let tasksToExpandCount = 0;
	const allTelemetryData = []; // Still collect individual data first

	try {
		logger.debug(`Reading tasks from ${tasksPath}`);
		const data = readJSON(tasksPath, projectRoot, tag);
		if (!data || !data.tasks) {
			throw new Error(`Invalid tasks data in ${tasksPath}`);
		}

		// --- Restore Original Filtering Logic ---
		const tasksToExpand = data.tasks.filter(
			(task) =>
				(task.status === 'pending' || task.status === 'in-progress') && // Include 'in-progress'
				(!task.subtasks || task.subtasks.length === 0 || force) // Check subtasks/force here
		);
		tasksToExpandCount = tasksToExpand.length; // Get the count from the filtered array
		// Pending tasks left out only because they already have subtasks
		const alreadyExpandedCount = force
			? 0
			: data.tasks.filter(
					(task) =>
						(task.status === 'pending' || task.status === 'in-progress') &&
						task.subtasks?.length > 0
				).length;
		progress(`Found ${tasksToExpandCount} tasks eligible for expansion.`);
		// --- End Restored Filtering Logic ---

		if (tasksToExpandCount === 0) {
			progress('No tasks eligible for expansion.');
			if (outputFormat === 'text' && !isMCPCall && !isSilentMode()) {
				console.log(
					ui.formatExpandAll({
						expandedCount: 0,
						skippedCount: 0,
						failedCount: 0,
						tasksToExpand: 0,
						alreadyExpandedCount
					})
				);
			}
			// --- Fix: Restore success: true and add message ---
			return {
				success: true, // Indicate overall success despite no action
				expandedCount: 0,
				failedCount: 0,
				skippedCount: 0,
				tasksToExpand: 0,
				alreadyExpandedCount,
				telemetryData: allTelemetryData,
				message: 'No tasks eligible for expansion.'
			};
			// --- End Fix ---
		}

		// Iterate over the already filtered tasks
		for (const task of tasksToExpand) {
			// expandTask shows its own spinner and what it added
			try {
				// Call the refactored expandTask function AND capture result
				const result = await expandTask(
					tasksPath,
					task.id,
					numSubtasks,
					useResearch,
					additionalContext,
					{
						...context,
						projectRoot,
						tag: data.tag || tag,
						complexityReportPath,
						// One usage line for the whole run, after the summary
						showUsage: false
					}, // Pass the whole context object with projectRoot and resolved tag
					force
				);
				if (result?.skipped) {
					// The complexity report recommended no expansion for this task
					skippedCount++;
					progress(
						`Skipped task ${task.id}: complexity report recommends no expansion.`
					);
					continue;
				}

				expandedCount++;

				// Collect individual telemetry data
				if (result && result.telemetryData) {
					allTelemetryData.push(result.telemetryData);
				}

				progress(`Expanded task ${task.id}.`);
			} catch (error) {
				failedCount++;
				logger.error(`Couldn't expand task ${task.id}: ${error.message}`);
				// Continue to the next task
			}
		}

		// --- AGGREGATION AND DISPLAY ---
		progress(
			`Expansion complete: ${expandedCount} expanded, ${skippedCount} skipped, ${failedCount} failed.`
		);

		// Aggregate the collected telemetry data
		const aggregatedTelemetryData = aggregateTelemetry(
			allTelemetryData,
			'expand-all-tasks'
		);

		if (outputFormat === 'text' && !isMCPCall && !isSilentMode()) {
			console.log(
				`\n${ui.formatExpandAll({
					expandedCount,
					skippedCount,
					failedCount,
					tasksToExpand: tasksToExpandCount
				})}`
			);
		}

		if (outputFormat === 'text' && aggregatedTelemetryData) {
			displayAiUsageSummary(aggregatedTelemetryData, 'cli');
		}

		// Return summary including the AGGREGATED telemetry data
		return {
			success: true,
			expandedCount,
			failedCount,
			skippedCount,
			tasksToExpand: tasksToExpandCount,
			alreadyExpandedCount,
			telemetryData: aggregatedTelemetryData
		};
	} catch (error) {
		logger.error(`Error during expand all operation: ${error.message}`);
		if (!isMCPCall && getDebugFlag(session)) {
			console.error(error); // Log full stack in debug CLI mode
		}
		// Re-throw error for the caller to handle, the direct function will format it
		throw error; // Let direct function wrapper handle formatting
		/* Original re-throw:
		throw new Error(`Failed to expand all tasks: ${error.message}`);
		*/
	}
}

export default expandAllTasks;
