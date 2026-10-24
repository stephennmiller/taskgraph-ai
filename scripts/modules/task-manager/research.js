/**
 * research.js
 * Core research functionality for AI-powered queries with project context
 */

import fs from 'fs';
import path from 'path';
import { ui } from '@tm/cli';
import chalk from 'chalk';
import { generateTextService } from '../ai-services-unified.js';
import { getPromptManager } from '../prompt-manager.js';
import {
	displayAiUsageSummary,
	startLoadingIndicator,
	stopLoadingIndicator
} from '../ui.js';
import {
	log as consoleLog,
	findProjectRoot,
	flattenTasksWithSubtasks,
	readJSON,
	writeJSON
} from '../utils.js';
import { ContextGatherer } from '../utils/contextGatherer.js';
import { FuzzyTaskSearch } from '../utils/fuzzyTaskSearch.js';

/** Remove the model's <think>…</think> reasoning, keeping only the answer */
function stripThinking(text) {
	return text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

/**
 * Perform AI-powered research with project context
 * @param {string} query - Research query/prompt
 * @param {Object} options - Research options
 * @param {Array<string>} [options.taskIds] - Task/subtask IDs for context
 * @param {Array<string>} [options.filePaths] - File paths for context
 * @param {string} [options.customContext] - Additional custom context
 * @param {boolean} [options.includeProjectTree] - Include project file tree
 * @param {string} [options.detailLevel] - Detail level: 'low', 'medium', 'high'
 * @param {string} [options.projectRoot] - Project root directory
 * @param {string} [options.tag] - Tag for the task
 * @param {boolean} [options.saveToFile] - Save the answer to .taskgraph/docs/research/
 * @param {Object} [context] - Execution context
 * @param {Object} [context.session] - MCP session object
 * @param {Object} [context.mcpLog] - MCP logger object
 * @param {string} [context.commandName] - Command name for telemetry
 * @param {string} [context.outputType] - Output type ('cli' or 'mcp')
 * @param {string} [outputFormat] - Output format ('text' or 'json')
 * @param {boolean} [allowFollowUp] - Whether to allow follow-up questions (default: true)
 * @returns {Promise<Object>} Research results with telemetry data
 */
async function performResearch(
	query,
	options = {},
	context = {},
	outputFormat = 'text',
	allowFollowUp = true
) {
	const {
		taskIds = [],
		filePaths = [],
		customContext = '',
		includeProjectTree = false,
		detailLevel = 'medium',
		projectRoot: providedProjectRoot,
		tag,
		saveToFile = false
	} = options;

	const {
		session,
		mcpLog,
		commandName = 'research',
		outputType = 'cli'
	} = context;
	const isMCP = !!mcpLog;
	const isText = outputFormat === 'text';

	// Determine project root
	const projectRoot = providedProjectRoot || findProjectRoot();
	if (!projectRoot) {
		throw new Error('Could not determine project root directory');
	}

	// MCP gets every log; on the CLI only warnings and errors print, since
	// the answer itself is the output.
	const logFn = isMCP
		? mcpLog
		: {
				info: (...args) => consoleLog('debug', ...args),
				warn: (...args) => consoleLog('warn', ...args),
				error: (...args) => consoleLog('debug', ...args),
				debug: (...args) => consoleLog('debug', ...args),
				success: (...args) => consoleLog('debug', ...args)
			};

	// Initialize context gatherer
	const contextGatherer = new ContextGatherer(projectRoot, tag);

	// Add tasks related to the question to the ones you asked for
	const requestedIds = taskIds.map(String);
	let relatedIds = [];

	try {
		const tasksPath = path.join(
			projectRoot,
			'.taskgraph',
			'tasks',
			'tasks.json'
		);
		const tasksData = await readJSON(tasksPath, projectRoot, tag);

		if (tasksData && tasksData.tasks && tasksData.tasks.length > 0) {
			// Flatten tasks to include subtasks for fuzzy search
			const flattenedTasks = flattenTasksWithSubtasks(tasksData.tasks);
			const fuzzySearch = new FuzzyTaskSearch(flattenedTasks, 'research');
			const searchResults = fuzzySearch.findRelevantTasks(query, {
				maxResults: 8,
				includeRecent: true,
				includeCategoryMatches: true
			});

			relatedIds = fuzzySearch
				.getTaskIds(searchResults)
				.map(String)
				.filter((id) => !requestedIds.includes(id));
		}
	} catch (error) {
		// Continue without related tasks
		logFn.debug(`Could not auto-discover tasks: ${error.message}`);
	}

	const finalTaskIds = [...requestedIds, ...relatedIds];

	const contextResult = await contextGatherer.gather({
		tasks: finalTaskIds,
		files: filePaths,
		customContext,
		includeProjectTree,
		format: 'research', // Use research format for AI consumption
		includeTokenCounts: true
	});

	const gatheredContext = contextResult.context;
	const tokenBreakdown = contextResult.tokenBreakdown;

	// Load prompts using PromptManager
	const promptManager = getPromptManager();

	const promptParams = {
		query: query,
		gatheredContext: gatheredContext || '',
		detailLevel: detailLevel,
		projectInfo: {
			root: projectRoot,
			taskCount: finalTaskIds.length,
			fileCount: filePaths.length
		}
	};

	// Load prompts - the research template handles detail level internally
	const { systemPrompt, userPrompt } = await promptManager.loadPrompt(
		'research',
		promptParams
	);

	// Count tokens for system and user prompts
	const systemPromptTokens = contextGatherer.countTokens(systemPrompt);
	const userPromptTokens = contextGatherer.countTokens(userPrompt);
	const totalInputTokens = systemPromptTokens + userPromptTokens;

	if (isText) {
		const contextLine = ui.formatResearchContext({
			taskIds: requestedIds,
			relatedTaskIds: relatedIds,
			files: filePaths,
			projectTree: includeProjectTree,
			customContext: Boolean(customContext)
		});
		if (contextLine) console.log(contextLine);
	}

	logFn.info(
		`Calling AI service with research role, context size: ${tokenBreakdown.total} tokens (${gatheredContext.length} characters)`
	);

	// The answer prints once, rendered, when it's complete. A spinner with
	// the elapsed time shows it's still working meanwhile.
	let spinner = null;
	let ticker = null;
	if (isText) {
		const started = Date.now();
		spinner = startLoadingIndicator('Researching…');
		if (spinner) {
			ticker = setInterval(() => {
				const seconds = Math.round((Date.now() - started) / 1000);
				spinner.text = `Researching… ${seconds}s`;
			}, 1000);
		}
	}

	let aiResult;
	try {
		aiResult = await generateTextService({
			role: 'research', // Always use research role for research command
			session,
			projectRoot,
			systemPrompt,
			prompt: userPrompt,
			commandName,
			outputType
		});
	} catch (error) {
		logFn.error(`Research query failed: ${error.message}`);
		throw error;
	} finally {
		if (ticker) clearInterval(ticker);
		stopLoadingIndicator(spinner);
	}

	const researchResult = stripThinking(aiResult.mainResult || '');
	const telemetryData = aiResult.telemetryData;
	const tagInfo = aiResult.tagInfo;

	let interactiveSaveInfo = { interactiveSaveOccurred: false };
	let savedFilePath;

	if (isText) {
		console.log(`\n${ui.formatResearchAnswer(researchResult)}`);

		if (telemetryData) {
			displayAiUsageSummary(telemetryData, 'cli');
		}
	}

	const conversationHistory = [
		{
			question: query,
			answer: researchResult,
			type: 'initial',
			timestamp: new Date().toISOString()
		}
	];

	// --save-file (CLI) or saveToFile (MCP)
	if (saveToFile) {
		savedFilePath = await handleSaveToFile(
			conversationHistory,
			projectRoot,
			context,
			logFn,
			outputFormat
		);
	}

	// Offer follow-ups and saving, only to a person at a terminal
	if (
		isText &&
		allowFollowUp &&
		!isMCP &&
		process.stdin.isTTY &&
		process.stdout.isTTY
	) {
		interactiveSaveInfo = await handleFollowUpQuestions(
			options,
			context,
			outputFormat,
			projectRoot,
			logFn,
			conversationHistory
		);
	}

	logFn.success('Research query completed successfully');

	return {
		query,
		result: researchResult,
		contextSize: gatheredContext.length,
		contextTokens: tokenBreakdown.total,
		tokenBreakdown,
		systemPromptTokens,
		userPromptTokens,
		totalInputTokens,
		detailLevel,
		telemetryData,
		tagInfo,
		...(savedFilePath ? { savedFilePath } : {}),
		interactiveSaveOccurred:
			interactiveSaveInfo?.interactiveSaveOccurred || false
	};
}

/**
 * Ask what to do after an answer: a follow-up question, saving, or done.
 * @param {Object} originalOptions - Original research options
 * @param {Object} context - Execution context
 * @param {string} outputFormat - Output format
 * @param {string} projectRoot - Project root directory
 * @param {Object} logFn - Logger function
 * @param {Array} conversationHistory - The question and answer so far
 */
async function handleFollowUpQuestions(
	originalOptions,
	context,
	outputFormat,
	projectRoot,
	logFn,
	conversationHistory
) {
	const { default: inquirer } = await import('inquirer');
	let interactiveSaveOccurred = false;

	try {
		while (true) {
			console.log();
			const { action } = await inquirer.prompt([
				{
					type: 'select',
					name: 'action',
					message: 'What next?',
					choices: [
						{ name: 'Ask a follow-up', value: 'followup' },
						{ name: 'Save to a file', value: 'savefile' },
						{ name: 'Save to a task', value: 'save' },
						{ name: 'Done', value: 'quit' }
					]
				}
			]);

			if (action === 'quit') {
				break;
			}

			if (action === 'savefile') {
				try {
					await handleSaveToFile(
						conversationHistory,
						projectRoot,
						context,
						logFn,
						outputFormat
					);
				} catch {
					// handleSaveToFile already said why
				}
				continue;
			}

			if (action === 'save') {
				const saved = await handleSaveToTask(
					conversationHistory,
					projectRoot,
					context,
					logFn
				);
				if (saved) {
					interactiveSaveOccurred = true;
				}
				continue;
			}

			if (action === 'followup') {
				const { followUpQuery } = await inquirer.prompt([
					{
						type: 'input',
						name: 'followUpQuery',
						message: 'Follow-up question:',
						validate: (input) =>
							input && input.trim().length > 0
								? true
								: 'Type a question, or press Ctrl-C to stop'
					}
				]);

				console.log();

				// Build cumulative conversation context from all previous exchanges
				const conversationContext =
					buildConversationContext(conversationHistory);

				// Create enhanced options for follow-up with full conversation context
				const followUpOptions = {
					...originalOptions,
					taskIds: [], // Clear task IDs to allow fresh fuzzy search
					saveToFile: false,
					customContext:
						conversationContext +
						(originalOptions.customContext
							? `\n\n--- Original Context ---\n${originalOptions.customContext}`
							: '')
				};

				const followUpResult = await performResearch(
					followUpQuery.trim(),
					followUpOptions,
					context,
					outputFormat,
					false // allowFollowUp = false for nested calls
				);

				conversationHistory.push({
					question: followUpQuery.trim(),
					answer: followUpResult.result,
					type: 'followup',
					timestamp: new Date().toISOString()
				});
			}
		}
	} catch (error) {
		// Ctrl-C at a prompt ends the session quietly
		if (error?.name !== 'ExitPromptError') {
			console.log(chalk.red(`✗ ${error.message}`));
		}
		logFn.debug(`Follow-up ended: ${error.message}`);
	}

	return { interactiveSaveOccurred };
}

/**
 * Append research to a task's or subtask's details as-is, the way
 * update-subtask adds notes. No AI call.
 *
 * @param {string} tasksPath - Path to tasks.json
 * @param {string} id - Task ID ("15") or subtask ID ("15.2")
 * @param {string} content - Markdown to append
 * @param {{ projectRoot?: string, tag?: string }} [context]
 * @returns {{ id: string, title: string }} The task or subtask saved to
 */
function appendResearchToTask(tasksPath, id, content, context = {}) {
	const { projectRoot, tag } = context;
	const trimmedId = String(id).trim();
	if (!/^\d+(\.\d+)?$/.test(trimmedId)) {
		throw new Error(`"${trimmedId}" isn't a task ID like 15 or 15.2`);
	}

	const data = readJSON(tasksPath, projectRoot, tag);
	if (!data || !Array.isArray(data.tasks)) {
		throw new Error('No tasks found');
	}

	const [parentId, subtaskId] = trimmedId
		.split('.')
		.map((part) => Number.parseInt(part, 10));
	const parent = data.tasks.find((task) => Number(task.id) === parentId);
	if (!parent) {
		throw new Error(`Task ${parentId} doesn't exist`);
	}

	let target = parent;
	if (subtaskId !== undefined) {
		target = (parent.subtasks || []).find(
			(subtask) => Number(subtask.id) === subtaskId
		);
		if (!target) {
			throw new Error(`Subtask ${trimmedId} doesn't exist`);
		}
	}

	const timestamp = new Date().toISOString();
	const block = `<info added on ${timestamp}>\n${content.trim()}\n</info added on ${timestamp}>`;
	target.details = target.details ? `${target.details}\n${block}` : block;

	writeJSON(tasksPath, data, projectRoot, tag);
	return { id: trimmedId, title: target.title };
}

/**
 * Ask for a task ID and save the conversation to it
 * @param {Array} conversationHistory - Array of conversation exchanges
 * @param {string} projectRoot - Project root directory
 * @param {Object} context - Execution context
 * @param {Object} logFn - Logger function
 * @returns {Promise<boolean>} Whether it saved
 */
async function handleSaveToTask(
	conversationHistory,
	projectRoot,
	context,
	logFn
) {
	const { default: inquirer } = await import('inquirer');
	const { taskId } = await inquirer.prompt([
		{
			type: 'input',
			name: 'taskId',
			message: 'Task ID (15, or 15.2 for a subtask):',
			validate: (input) =>
				/^\d+(\.\d+)?$/.test((input || '').trim())
					? true
					: 'Use 15 for a task or 15.2 for a subtask'
		}
	]);

	const target = { kind: 'task', id: taskId.trim() };
	const tasksPath = path.join(projectRoot, '.taskgraph', 'tasks', 'tasks.json');

	try {
		appendResearchToTask(
			tasksPath,
			target.id,
			formatConversationForSaving(conversationHistory),
			{ projectRoot, tag: context.tag }
		);
		console.log(ui.formatResearchSaved(target));
		return true;
	} catch (error) {
		console.log(ui.formatResearchSaveFailed(target, error.message));
		logFn.debug(`Error saving conversation: ${error.message}`);
		return false;
	}
}

/**
 * Save the conversation to a file in .taskgraph/docs/research/
 * @param {Array} conversationHistory - Array of conversation exchanges
 * @param {string} projectRoot - Project root directory
 * @param {Object} context - Execution context
 * @param {Object} logFn - Logger function
 * @param {string} [outputFormat] - 'text' prints where it saved
 * @returns {Promise<string>} Path to saved file
 */
async function handleSaveToFile(
	conversationHistory,
	projectRoot,
	context,
	logFn,
	outputFormat = 'text'
) {
	try {
		const researchDir = path.join(
			projectRoot,
			'.taskgraph',
			'docs',
			'research'
		);
		if (!fs.existsSync(researchDir)) {
			fs.mkdirSync(researchDir, { recursive: true });
		}

		// Generate filename from first query and timestamp
		const firstQuery = conversationHistory[0]?.question || 'research-query';
		const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

		// Create a slug from the query (remove special chars, limit length)
		const querySlug = firstQuery
			.toLowerCase()
			.replace(/[^a-z0-9\s-]/g, '') // Remove special characters
			.replace(/\s+/g, '-') // Replace spaces with hyphens
			.replace(/-+/g, '-') // Replace multiple hyphens with single
			.substring(0, 50) // Limit length
			.replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens

		const filename = `${timestamp}_${querySlug}.md`;
		const filePath = path.join(researchDir, filename);

		const fileContent = formatConversationForFile(
			conversationHistory,
			firstQuery
		);

		fs.writeFileSync(filePath, fileContent, 'utf8');

		const relativePath = path.relative(projectRoot, filePath);
		if (outputFormat === 'text') {
			console.log(ui.formatResearchSaved({ kind: 'file', path: relativePath }));
		}
		logFn.success(`Research conversation saved to ${relativePath}`);

		return filePath;
	} catch (error) {
		if (outputFormat === 'text') {
			console.log(
				ui.formatResearchSaveFailed({ kind: 'file', path: '' }, error.message)
			);
		}
		logFn.error(`Error saving research file: ${error.message}`);
		throw error;
	}
}

/**
 * Format conversation history for saving to a file
 * @param {Array} conversationHistory - Array of conversation exchanges
 * @param {string} initialQuery - The initial query for metadata
 * @returns {string} Formatted file content
 */
function formatConversationForFile(conversationHistory, initialQuery) {
	const timestamp = new Date().toISOString();
	const date = new Date().toLocaleDateString();
	const time = new Date().toLocaleTimeString();

	// Create metadata header
	let content = `---
title: Research Session
query: "${initialQuery}"
date: ${date}
time: ${time}
timestamp: ${timestamp}
exchanges: ${conversationHistory.length}
---

# Research Session

`;

	// Add each conversation exchange
	conversationHistory.forEach((exchange, index) => {
		if (exchange.type === 'initial') {
			content += `## Initial Query\n\n**Question:** ${exchange.question}\n\n**Response:**\n\n${exchange.answer}\n\n`;
		} else {
			content += `## Follow-up ${index}\n\n**Question:** ${exchange.question}\n\n**Response:**\n\n${exchange.answer}\n\n`;
		}

		if (index < conversationHistory.length - 1) {
			content += '---\n\n';
		}
	});

	// Add footer
	content += `\n---\n\n*Generated by TaskGraph Research Command*  \n*Timestamp: ${timestamp}*\n`;

	return content;
}

/**
 * Format conversation history for saving to a task/subtask
 * @param {Array} conversationHistory - Array of conversation exchanges
 * @returns {string} Formatted conversation thread
 */
function formatConversationForSaving(conversationHistory) {
	const timestamp = new Date().toISOString();
	let formatted = `## Research Session - ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}\n\n`;

	conversationHistory.forEach((exchange, index) => {
		if (exchange.type === 'initial') {
			formatted += `**Initial Query:** ${exchange.question}\n\n`;
			formatted += `**Response:** ${exchange.answer}\n\n`;
		} else {
			formatted += `**Follow-up ${index}:** ${exchange.question}\n\n`;
			formatted += `**Response:** ${exchange.answer}\n\n`;
		}

		if (index < conversationHistory.length - 1) {
			formatted += '---\n\n';
		}
	});

	return formatted;
}

/**
 * Build conversation context string from conversation history
 * @param {Array} conversationHistory - Array of conversation exchanges
 * @returns {string} Formatted conversation context
 */
function buildConversationContext(conversationHistory) {
	if (conversationHistory.length === 0) {
		return '';
	}

	const contextParts = ['--- Conversation History ---'];

	conversationHistory.forEach((exchange, index) => {
		const questionLabel =
			exchange.type === 'initial' ? 'Initial Question' : `Follow-up ${index}`;
		const answerLabel =
			exchange.type === 'initial' ? 'Initial Answer' : `Answer ${index}`;

		contextParts.push(`\n${questionLabel}: ${exchange.question}`);
		contextParts.push(`${answerLabel}: ${exchange.answer}`);
	});

	return contextParts.join('\n');
}

export { appendResearchToTask, performResearch };
