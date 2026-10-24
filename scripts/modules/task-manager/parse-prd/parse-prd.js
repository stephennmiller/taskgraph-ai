import { ui } from '@tm/cli';
import {
	buildPrdSnapshot,
	diffPrdSections,
	getPrdSnapshot,
	hasPrdChanges,
	nextTaskId,
	parsePrdSections,
	prdDeltaContent,
	prdPathForSource,
	readArchivedIdsSync,
	stripTerminalControls
} from '@tm/core';
import { getDebugFlag, getDefaultPriority } from '../../config-manager.js';

// Import configuration classes
import { LoggingConfig, PrdParseConfig } from './parse-prd-config.js';

// Import helper functions
import {
	buildPrompts,
	displayNonStreamingCliOutput,
	loadExistingTasks,
	processTasks,
	readPrdContent,
	saveTasksToFile,
	validateFileOperations
} from './parse-prd-helpers.js';

import { handleNonStreamingService } from './parse-prd-non-streaming.js';

// ============================================================================
// MAIN PARSING FUNCTIONS (Simplified after refactoring)
// ============================================================================

/**
 * Parse a PRD into tasks
 * @param {PrdParseConfig} config - Configuration object
 * @returns {Promise<Object>} Result object with success status and telemetry
 */
async function parsePRDCore(config) {
	const logger = new LoggingConfig(config.mcpLog, config.reportProgress);

	logger.report(
		`Parsing PRD file: ${config.prdPath}, Force: ${config.force}, Append: ${config.append}, Research: ${config.research}`,
		'debug'
	);

	try {
		// Load existing tasks
		const loaded = loadExistingTasks(config.tasksPath, config.targetTag);
		// Overwriting (--force) replaces the list, so numbering starts over
		// (above any archived IDs, which stay reserved); only --append
		// continues after the existing tasks
		const existingTasks = config.append ? loaded.existingTasks : [];
		const nextId = config.append ? loaded.nextId : loaded.firstFreeId;

		// Validate operations
		validateFileOperations({
			existingTasks: loaded.existingTasks,
			targetTag: config.targetTag,
			append: config.append,
			force: config.force,
			isMCP: config.isMCP,
			logger
		});

		// Read PRD content and build prompts. Each task names the PRD section
		// it implements, so the prompt lists the headings it can cite
		const prdContent = readPrdContent(config.prdPath);
		const prd = {
			path: prdPathForSource(
				config.projectRoot || process.cwd(),
				config.prdPath
			),
			sections: parsePrdSections(prdContent)
		};
		// The section hashes this parse records in the tag, so the next
		// --append can tell which sections are new, changed or removed. A parse
		// without --append replaces the tasks, so it drops other PRDs' hashes
		const prdSnapshot =
			prd.sections.length > 0 || !config.append
				? {
						path: prd.path,
						snapshot: buildPrdSnapshot(prd.sections),
						replace: !config.append
					}
				: undefined;

		// --append sends the AI only the sections added since the last parse.
		// Changed and removed ones are reported; their tasks are left alone
		const prdDelta =
			config.append && prd.sections.length > 0
				? diffPrdSections(
						prd.sections,
						prd.path,
						existingTasks,
						getPrdSnapshot(loaded.tagMetadata, prd.path)
					)
				: null;
		const deltaOnly = Boolean(prdDelta?.known);
		if (deltaOnly && config.outputFormat === 'text' && !config.isMCP) {
			console.log(ui.formatPrdDelta(prdDelta));
		}
		if (deltaOnly && prdDelta.added.length === 0) {
			// Nothing new: no AI call and no new tasks. Record the PRD as it is
			// now, so a change or removal is reported once
			if (hasPrdChanges(prdDelta)) {
				// null keeps the tag's tasks as the file has them now: only the
				// recorded hashes change
				saveTasksToFile(
					config.tasksPath,
					null,
					config.targetTag,
					logger,
					prdSnapshot
				);
			}
			return {
				success: true,
				tasksPath: config.tasksPath,
				addedTasks: 0,
				prdDelta,
				telemetryData: null,
				tagInfo: null
			};
		}

		// A count meant for the whole PRD doesn't fit a few new sections, so
		// for those the model decides how many tasks they need
		const numTasks = deltaOnly ? 0 : config.numTasks;
		const prompts = await buildPrompts(
			config,
			deltaOnly ? prdDeltaContent(prdDelta, prdContent) : prdContent,
			nextId,
			deltaOnly ? { ...prd, sections: prdDelta.added } : prd,
			{ numTasks, newSectionsOnly: deltaOnly, existingTasks }
		);

		// Call the appropriate service handler
		const serviceResult = await handleNonStreamingService(
			config,
			prompts,
			numTasks,
			nextId
		);

		// Number the new tasks and save them against the tag as the file has it
		// now, under the lock: another command may have changed the tag while
		// the model ran, and its changes and IDs must survive
		const defaultPriority = getDefaultPriority(config.projectRoot) || 'medium';
		let processedNewTasks = [];
		let finalTasks = [];
		saveTasksToFile(
			config.tasksPath,
			(currentTasks) => {
				// A plain parse was allowed because the tag was empty; tasks added
				// since then are replaced only with --force
				if (!config.append && !config.force && currentTasks.length > 0) {
					throw new Error(
						`Tasks were added to tag '${stripTerminalControls(String(config.targetTag), { singleLine: true })}' while the PRD was being parsed. Run again with --append to add to them or --force to replace them`
					);
				}
				// Overwriting (--force) replaces the list
				const keptTasks = config.append ? currentTasks : [];
				const keptIds = keptTasks.map((t) => t.id);
				const archived = readArchivedIdsSync(
					config.tasksPath,
					config.targetTag
				);
				processedNewTasks = processTasks(
					serviceResult.parsedTasks,
					nextTaskId(keptIds, archived.highestId),
					// A dependency on a task archived while the model ran still
					// names a real task
					config.append ? [...keptIds, ...archived.ids] : [],
					defaultPriority,
					prd,
					nextId
				);
				finalTasks = [...keptTasks, ...processedNewTasks];
				return finalTasks;
			},
			config.targetTag,
			logger,
			prdSnapshot
		);

		// Handle completion reporting
		await handleCompletionReporting(
			config,
			serviceResult,
			processedNewTasks,
			finalTasks
		);

		return {
			success: true,
			tasksPath: config.tasksPath,
			addedTasks: processedNewTasks.length,
			prdDelta,
			telemetryData: serviceResult.aiServiceResponse?.telemetryData,
			tagInfo: serviceResult.aiServiceResponse?.tagInfo
		};
	} catch (error) {
		// In the terminal the command prints the reason once; repeating it here
		// showed the same message three times
		if (config.isMCP) {
			logger.report(`Error parsing PRD: ${error.message}`, 'error');
		} else if (getDebugFlag(config.projectRoot)) {
			console.error(error);
		}
		throw error;
	}
}

/**
 * Handle completion reporting for both CLI and MCP
 * @param {PrdParseConfig} config - Configuration object
 * @param {Object} serviceResult - Result from service handler
 * @param {Array} processedNewTasks - New tasks that were processed
 * @param {Array} finalTasks - All tasks after processing
 */
async function handleCompletionReporting(
	config,
	serviceResult,
	processedNewTasks,
	finalTasks
) {
	const { aiServiceResponse, estimatedInputTokens } = serviceResult;

	// MCP progress reporting
	if (config.reportProgress) {
		const hasValidTelemetry =
			aiServiceResponse?.telemetryData &&
			(aiServiceResponse.telemetryData.inputTokens > 0 ||
				aiServiceResponse.telemetryData.outputTokens > 0);

		let completionMessage;
		if (hasValidTelemetry) {
			const cost = aiServiceResponse.telemetryData.totalCost || 0;
			const currency = aiServiceResponse.telemetryData.currency || 'USD';
			completionMessage = `✅ Task Generation Completed | Tokens (I/O): ${aiServiceResponse.telemetryData.inputTokens}/${aiServiceResponse.telemetryData.outputTokens} | Cost: ${currency === 'USD' ? '$' : currency}${cost.toFixed(4)}`;
		} else {
			completionMessage = `✅ Task Generation Completed | ~Tokens (I/O): ${estimatedInputTokens}/unknown | Cost: ~$0.00`;
		}

		// The count asked for can be 0 (sized to the PRD), so report what came back
		await config.reportProgress({
			progress: processedNewTasks.length,
			total: processedNewTasks.length,
			message: completionMessage
		});
	}

	// CLI output
	if (config.outputFormat === 'text' && !config.isMCP) {
		displayNonStreamingCliOutput({
			processedTasks: processedNewTasks,
			research: config.research,
			finalTasks,
			tasksPath: config.tasksPath,
			aiServiceResponse
		});
	}
}

/**
 * Main entry point
 */
async function parsePRD(prdPath, tasksPath, numTasks, options = {}) {
	return parsePRDCore(
		new PrdParseConfig(prdPath, tasksPath, numTasks, options)
	);
}

export default parsePRD;
