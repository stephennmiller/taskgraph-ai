import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

import { isSilentMode, log, readJSON } from '../utils.js';

import {
	displayAiUsageSummary,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';

import { COMMAND_SCHEMAS } from '../../../src/schemas/registry.js';
import { generateObjectService } from '../ai-services-unified.js';

import { printError, ui } from '@tm/cli';
import { TASKGRAPH_TASKS_FILE } from '../../../src/constants/paths.js';
import { resolveComplexityReportOutputPath } from '../../../src/utils/path-utils.js';
import {
	getDebugFlag,
	getProjectName,
	hasCodebaseAnalysis
} from '../config-manager.js';
import { getPromptManager } from '../prompt-manager.js';
import { flattenTasksWithSubtasks } from '../utils.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';

/** The report path relative to the project, as the user would type it */
function displayPath(filePath, projectRoot) {
	const relative = path.relative(projectRoot || process.cwd(), filePath);
	return relative && !relative.startsWith('..') ? relative : filePath;
}

/**
 * Analyzes task complexity and generates expansion recommendations
 * @param {Object} options Command options
 * @param {string} options.file - Path to tasks file
 * @param {string} options.output - Path to report output file
 * @param {string|number} [options.threshold] - Complexity threshold
 * @param {boolean} [options.research] - Use research role
 * @param {string} [options.projectRoot] - Project root path (for MCP/env fallback).
 * @param {string} [options.tag] - Tag for the task
 * @param {string} [options.id] - Comma-separated list of task IDs to analyze specifically
 * @param {number} [options.from] - Starting task ID in a range to analyze
 * @param {number} [options.to] - Ending task ID in a range to analyze
 * @param {Object} [options._filteredTasksData] - Pre-filtered task data (internal use)
 * @param {number} [options._originalTaskCount] - Original task count (internal use)
 * @param {Object} context - Context object, potentially containing session and mcpLog
 * @param {Object} [context.session] - Session object from MCP server (optional)
 * @param {Object} [context.mcpLog] - MCP logger object (optional)
 * @param {function} [context.reportProgress] - Deprecated: Function to report progress (ignored)
 */
async function analyzeTaskComplexity(options, context = {}) {
	const { session, mcpLog } = context;
	const tasksPath = options.file || TASKGRAPH_TASKS_FILE;
	const thresholdScore = parseFloat(options.threshold || '5');
	const useResearch = options.research || false;
	const projectRoot = options.projectRoot;
	const tag = options.tag;
	// New parameters for task ID filtering
	const specificIds = options.id
		? options.id
				.split(',')
				.map((id) => parseInt(id.trim(), 10))
				.filter((id) => !Number.isNaN(id))
		: null;
	const fromId = options.from !== undefined ? parseInt(options.from, 10) : null;
	const toId = options.to !== undefined ? parseInt(options.to, 10) : null;

	const outputFormat = mcpLog ? 'json' : 'text';

	// Progress details go to MCP, or to the debug log on the CLI: the CLI
	// shows one summary at the end instead
	const reportLog = (message, level = 'info') => {
		if (mcpLog) {
			mcpLog[level](message);
		} else if (!isSilentMode() && outputFormat === 'text') {
			log(level === 'warn' || level === 'error' ? level : 'debug', message);
		}
	};

	// Resolve output path using tag-aware resolution
	const outputPath = resolveComplexityReportOutputPath(
		options.output,
		{ projectRoot, tag },
		reportLog
	);

	try {
		reportLog(`Reading tasks from ${tasksPath}...`, 'info');
		let tasksData;
		let originalTaskCount = 0;
		let originalData = null;

		if (options._filteredTasksData) {
			tasksData = options._filteredTasksData;
			originalTaskCount = options._originalTaskCount || tasksData.tasks.length;
			if (!options._originalTaskCount) {
				try {
					originalData = readJSON(tasksPath, projectRoot, tag);
					if (originalData && originalData.tasks) {
						originalTaskCount = originalData.tasks.length;
					}
				} catch (e) {
					log('warn', `Could not read original tasks file: ${e.message}`);
				}
			}
		} else {
			originalData = readJSON(tasksPath, projectRoot, tag);
			if (
				!originalData ||
				!originalData.tasks ||
				!Array.isArray(originalData.tasks) ||
				originalData.tasks.length === 0
			) {
				throw new Error('No tasks found in the tasks file');
			}
			originalTaskCount = originalData.tasks.length;

			// Filter tasks based on active status
			const activeStatuses = ['pending', 'blocked', 'in-progress'];
			let filteredTasks = originalData.tasks.filter((task) =>
				activeStatuses.includes(task.status?.toLowerCase() || 'pending')
			);

			// Apply ID filtering if specified
			if (specificIds && specificIds.length > 0) {
				reportLog(
					`Filtering tasks by specific IDs: ${specificIds.join(', ')}`,
					'info'
				);
				filteredTasks = filteredTasks.filter((task) =>
					specificIds.includes(task.id)
				);

				if (outputFormat === 'text') {
					if (filteredTasks.length === 0 && specificIds.length > 0) {
						console.log(
							chalk.yellow(
								`Warning: No active tasks found with IDs: ${specificIds.join(', ')}`
							)
						);
					} else if (filteredTasks.length < specificIds.length) {
						const foundIds = filteredTasks.map((t) => t.id);
						const missingIds = specificIds.filter(
							(id) => !foundIds.includes(id)
						);
						console.log(
							chalk.yellow(
								`Warning: Some requested task IDs were not found or are not active: ${missingIds.join(', ')}`
							)
						);
					}
				}
			}
			// Apply range filtering if specified
			else if (fromId !== null || toId !== null) {
				const effectiveFromId = fromId !== null ? fromId : 1;
				const effectiveToId =
					toId !== null
						? toId
						: Math.max(...originalData.tasks.map((t) => t.id));

				reportLog(
					`Filtering tasks by ID range: ${effectiveFromId} to ${effectiveToId}`,
					'info'
				);
				filteredTasks = filteredTasks.filter(
					(task) => task.id >= effectiveFromId && task.id <= effectiveToId
				);

				if (outputFormat === 'text' && filteredTasks.length === 0) {
					console.log(
						chalk.yellow(
							`Warning: No active tasks found in range: ${effectiveFromId}-${effectiveToId}`
						)
					);
				}
			}

			tasksData = {
				...originalData,
				tasks: filteredTasks,
				_originalTaskCount: originalTaskCount
			};
		}

		// --- Context Gathering ---
		let gatheredContext = '';
		if (originalData && originalData.tasks.length > 0) {
			try {
				const contextGatherer = new ContextGatherer(projectRoot, tag);
				const allTasksFlat = flattenTasksWithSubtasks(originalData.tasks);
				const fuzzySearch = new FuzzyTaskSearch(
					allTasksFlat,
					'analyze-complexity'
				);
				// Create a query from the tasks being analyzed
				const searchQuery = tasksData.tasks
					.map((t) => `${t.title} ${t.description}`)
					.join(' ');
				const searchResults = fuzzySearch.findRelevantTasks(searchQuery, {
					maxResults: 10
				});
				const relevantTaskIds = fuzzySearch.getTaskIds(searchResults);

				if (relevantTaskIds.length > 0) {
					const contextResult = await contextGatherer.gather({
						tasks: relevantTaskIds,
						format: 'research'
					});
					gatheredContext = contextResult.context || '';
				}
			} catch (contextError) {
				reportLog(
					`Could not gather additional context: ${contextError.message}`,
					'warn'
				);
			}
		}
		// --- End Context Gathering ---

		const skippedCount = originalTaskCount - tasksData.tasks.length;
		reportLog(
			`Found ${originalTaskCount} total tasks in the task file.`,
			'info'
		);

		// Updated messaging to reflect filtering logic
		if (specificIds || fromId !== null || toId !== null) {
			const filterMsg = specificIds
				? `Analyzing ${tasksData.tasks.length} tasks with specific IDs: ${specificIds.join(', ')}`
				: `Analyzing ${tasksData.tasks.length} tasks in range: ${fromId || 1} to ${toId || 'end'}`;

			reportLog(filterMsg, 'info');
		} else if (skippedCount > 0) {
			const skipMessage = `Skipping ${skippedCount} tasks marked as done/cancelled/deferred. Analyzing ${tasksData.tasks.length} active tasks.`;
			reportLog(skipMessage, 'info');
		}

		// Check for existing report before doing analysis
		let existingReport = null;
		const existingAnalysisMap = new Map(); // For quick lookups by task ID
		try {
			if (fs.existsSync(outputPath)) {
				existingReport = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
				reportLog(`Found existing complexity report at ${outputPath}`, 'info');

				if (
					existingReport &&
					existingReport.complexityAnalysis &&
					Array.isArray(existingReport.complexityAnalysis)
				) {
					// Create lookup map of existing analysis entries
					existingReport.complexityAnalysis.forEach((item) => {
						existingAnalysisMap.set(item.taskId, item);
					});
					reportLog(
						`Existing report contains ${existingReport.complexityAnalysis.length} task analyses`,
						'info'
					);
				}
			}
		} catch (readError) {
			reportLog(
				`Warning: Could not read existing report: ${readError.message}`,
				'warn'
			);
			existingReport = null;
			existingAnalysisMap.clear();
		}

		if (tasksData.tasks.length === 0) {
			// If using ID filtering but no matching tasks, return existing report or empty
			if (existingReport && (specificIds || fromId !== null || toId !== null)) {
				reportLog(
					'No matching tasks found for analysis. Keeping existing report.',
					'info'
				);
				if (outputFormat === 'text') {
					console.log(
						chalk.yellow(
							'No matching tasks found for analysis. Keeping existing report.'
						)
					);
				}
				return {
					report: existingReport,
					telemetryData: null
				};
			}

			// Otherwise create empty report
			const emptyReport = {
				meta: {
					generatedAt: new Date().toISOString(),
					tasksAnalyzed: 0,
					thresholdScore: thresholdScore,
					projectName: getProjectName(session),
					usedResearch: useResearch
				},
				complexityAnalysis: existingReport?.complexityAnalysis || []
			};
			reportLog(`Writing complexity report to ${outputPath}...`, 'info');
			fs.writeFileSync(
				outputPath,
				JSON.stringify(emptyReport, null, '\t'),
				'utf8'
			);
			reportLog(
				`Task complexity analysis complete. Report written to ${outputPath}`,
				'success'
			);
			if (outputFormat === 'text') {
				console.log(
					ui.formatComplexityRun({
						analyses: [],
						skipped: skippedCount,
						kept: 0,
						reportPath: displayPath(outputPath, projectRoot)
					})
				);
			}
			return {
				report: emptyReport,
				telemetryData: null
			};
		}

		// Continue with regular analysis path
		// Load prompts using PromptManager
		const promptManager = getPromptManager();

		// Check if Claude Code is being used as the provider

		const promptParams = {
			tasks: tasksData.tasks,
			gatheredContext: gatheredContext || '',
			useResearch: useResearch,
			hasCodebaseAnalysis: hasCodebaseAnalysis(
				useResearch,
				projectRoot,
				session
			),
			projectRoot: projectRoot || ''
		};

		const { systemPrompt, userPrompt: prompt } = await promptManager.loadPrompt(
			'analyze-complexity',
			promptParams,
			'default'
		);

		let loadingIndicator = null;
		if (outputFormat === 'text') {
			const count = tasksData.tasks.length;
			loadingIndicator = startLoadingIndicator(
				`Analyzing ${count} ${count === 1 ? 'task' : 'tasks'}${useResearch ? ' with web research' : ''}…`
			);
		}

		let aiServiceResponse = null;
		let complexityAnalysis = null;

		try {
			const role = useResearch ? 'research' : 'main';

			aiServiceResponse = await generateObjectService({
				prompt,
				systemPrompt,
				role,
				session,
				projectRoot,
				schema: COMMAND_SCHEMAS['analyze-complexity'],
				objectName: 'complexityAnalysis',
				commandName: 'analyze-complexity',
				outputType: mcpLog ? 'mcp' : 'cli'
			});

			if (loadingIndicator) {
				stopLoadingIndicator(loadingIndicator);
				loadingIndicator = null;
			}
			// With generateObject, we get structured data directly
			complexityAnalysis = aiServiceResponse.mainResult?.complexityAnalysis;
			reportLog(
				`Received ${complexityAnalysis.length} complexity analyses from AI.`,
				'info'
			);

			const taskIds = tasksData.tasks.map((t) => t.id);
			const analysisTaskIds = complexityAnalysis.map((a) => a.taskId);
			const missingTaskIds = taskIds.filter(
				(id) => !analysisTaskIds.includes(id)
			);

			if (missingTaskIds.length > 0) {
				reportLog(
					`Missing analysis for ${missingTaskIds.length} tasks: ${missingTaskIds.join(', ')}`,
					'warn'
				);
				for (const missingId of missingTaskIds) {
					const missingTask = tasksData.tasks.find((t) => t.id === missingId);
					if (missingTask) {
						reportLog(`Adding default analysis for task ${missingId}`, 'info');
						complexityAnalysis.push({
							taskId: missingId,
							taskTitle: missingTask.title,
							complexityScore: 5,
							recommendedSubtasks: 3,
							expansionPrompt: `Break down this task with a focus on ${missingTask.title.toLowerCase()}.`,
							reasoning:
								'Automatically added due to missing analysis in AI response.'
						});
					}
				}
			}

			// Merge with existing report - only keep entries from the current tag
			let finalComplexityAnalysis = [];

			if (existingReport && Array.isArray(existingReport.complexityAnalysis)) {
				// Create a map of task IDs that we just analyzed
				const analyzedTaskIds = new Set(
					complexityAnalysis.map((item) => item.taskId)
				);

				// Keep existing entries that weren't in this analysis run AND belong to the current tag
				// We determine tag membership by checking if the task ID exists in the current tag's tasks
				const currentTagTaskIds = new Set(tasksData.tasks.map((t) => t.id));
				const existingEntriesNotAnalyzed =
					existingReport.complexityAnalysis.filter(
						(item) =>
							!analyzedTaskIds.has(item.taskId) &&
							currentTagTaskIds.has(item.taskId) // Only keep entries for tasks in current tag
					);

				// Combine with new analysis
				finalComplexityAnalysis = [
					...existingEntriesNotAnalyzed,
					...complexityAnalysis
				];

				reportLog(
					`Merged ${complexityAnalysis.length} new analyses with ${existingEntriesNotAnalyzed.length} existing entries from current tag`,
					'info'
				);
			} else {
				// No existing report or invalid format, just use the new analysis
				finalComplexityAnalysis = complexityAnalysis;
			}

			const report = {
				meta: {
					generatedAt: new Date().toISOString(),
					tasksAnalyzed: tasksData.tasks.length,
					totalTasks: originalTaskCount,
					analysisCount: finalComplexityAnalysis.length,
					thresholdScore: thresholdScore,
					projectName: getProjectName(session),
					usedResearch: useResearch
				},
				complexityAnalysis: finalComplexityAnalysis
			};
			reportLog(`Writing complexity report to ${outputPath}...`, 'info');
			fs.writeFileSync(outputPath, JSON.stringify(report, null, '\t'), 'utf8');

			reportLog(
				`Task complexity analysis complete. Report written to ${outputPath}`,
				'success'
			);

			if (outputFormat === 'text') {
				console.log(
					ui.formatComplexityRun({
						analyses: complexityAnalysis,
						skipped: skippedCount,
						kept: finalComplexityAnalysis.length - complexityAnalysis.length,
						reportPath: displayPath(outputPath, projectRoot),
						usedResearch: useResearch
					})
				);

				if (getDebugFlag(session)) {
					console.debug(
						chalk.dim(
							`Final analysis object: ${JSON.stringify(report, null, 2)}`
						)
					);
				}

				if (aiServiceResponse.telemetryData) {
					displayAiUsageSummary(aiServiceResponse.telemetryData, 'cli');
				}
			}

			return {
				report: report,
				telemetryData: aiServiceResponse?.telemetryData,
				tagInfo: aiServiceResponse?.tagInfo
			};
		} catch (aiError) {
			if (loadingIndicator) stopLoadingIndicator(loadingIndicator);
			if (mcpLog) {
				reportLog(`Error during AI service call: ${aiError.message}`, 'error');
			}
			throw aiError;
		}
	} catch (error) {
		if (mcpLog) {
			reportLog(`Error analyzing task complexity: ${error.message}`, 'error');
		}
		if (outputFormat === 'text') {
			printError(`Couldn't analyze task complexity: ${error.message}`);
			if (getDebugFlag(session)) {
				console.error(error);
			}
			process.exit(1);
		} else {
			throw error;
		}
	}
}

export default analyzeTaskComplexity;
