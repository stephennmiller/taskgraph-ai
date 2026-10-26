/**
 * @fileoverview The MCP tools by name, the tiers TASKGRAPH_TOOLS picks from,
 * and registerTaskGraphTools, which registers the chosen set. `core` is the
 * default. `all` registers every tool and gives the MCP host full project
 * control; prefer `core` or `standard`.
 */

import type { FastMCP } from 'fastmcp';
import { logger } from '../logger.js';
import {
	registerGithubPushTool,
	registerGithubStatusTool
} from './github/index.js';
import {
	registerModelsTool,
	registerResponseLanguageTool
} from './settings/index.js';
import { registerInitializeProjectTool } from './setup/index.js';
import {
	registerAddTagTool,
	registerCopyTagTool,
	registerDeleteTagTool,
	registerListTagsTool,
	registerRenameTagTool,
	registerUseTagTool
} from './tags/index.js';
import {
	registerAddDependencyTool,
	registerAddNoteTool,
	registerAddSubtaskTool,
	registerAddTaskTool,
	registerAnalyzeComplexityTool,
	registerArchiveTasksTool,
	registerClearSubtasksTool,
	registerComplexityReportTool,
	registerDependencyAnalysisTool,
	registerExpandAllTool,
	registerExpandTaskTool,
	registerFixDependenciesTool,
	registerGenerateTool,
	registerGetTasksTool,
	registerGetTaskTool,
	registerMoveTaskTool,
	registerNextTaskTool,
	registerParsePrdTool,
	registerRemoveDependencyTool,
	registerRemoveSubtaskTool,
	registerRemoveTaskTool,
	registerResearchTool,
	registerScopeDownTool,
	registerScopeUpTool,
	registerSetTaskStatusTool,
	registerUpdateSubtaskTool,
	registerUpdateTaskTool,
	registerUpdateTool,
	registerValidateDependenciesTool
} from './tasks/index.js';

/** Every tool by the name clients see, in the order `all` registers them */
export const toolRegistry: Record<string, (server: FastMCP) => void> = {
	initialize_project: registerInitializeProjectTool,
	models: registerModelsTool,
	parse_prd: registerParsePrdTool,
	'response-language': registerResponseLanguageTool,
	analyze_project_complexity: registerAnalyzeComplexityTool,
	expand_task: registerExpandTaskTool,
	expand_all: registerExpandAllTool,
	scope_up_task: registerScopeUpTool,
	scope_down_task: registerScopeDownTool,
	get_tasks: registerGetTasksTool,
	get_task: registerGetTaskTool,
	next_task: registerNextTaskTool,
	complexity_report: registerComplexityReportTool,
	dependency_analysis: registerDependencyAnalysisTool,
	set_task_status: registerSetTaskStatusTool,
	add_task: registerAddTaskTool,
	add_subtask: registerAddSubtaskTool,
	update: registerUpdateTool,
	update_task: registerUpdateTaskTool,
	update_subtask: registerUpdateSubtaskTool,
	add_note: registerAddNoteTool,
	remove_task: registerRemoveTaskTool,
	remove_subtask: registerRemoveSubtaskTool,
	clear_subtasks: registerClearSubtasksTool,
	move_task: registerMoveTaskTool,
	add_dependency: registerAddDependencyTool,
	remove_dependency: registerRemoveDependencyTool,
	validate_dependencies: registerValidateDependenciesTool,
	fix_dependencies: registerFixDependenciesTool,
	archive_tasks: registerArchiveTasksTool,
	list_tags: registerListTagsTool,
	add_tag: registerAddTagTool,
	delete_tag: registerDeleteTagTool,
	use_tag: registerUseTagTool,
	rename_tag: registerRenameTagTool,
	copy_tag: registerCopyTagTool,
	research: registerResearchTool,
	generate: registerGenerateTool,
	github_status: registerGithubStatusTool,
	github_push: registerGithubPushTool
};

/** The 7 tools for daily work (TASKGRAPH_TOOLS=core, the default) */
export const coreTools = [
	'get_tasks',
	'next_task',
	'get_task',
	'set_task_status',
	'add_note',
	'parse_prd',
	'expand_task'
];

/** The core tools plus the 9 used most after them (TASKGRAPH_TOOLS=standard) */
export const standardTools = [
	...coreTools,
	'update_subtask',
	'initialize_project',
	'analyze_project_complexity',
	'expand_all',
	'add_subtask',
	'remove_task',
	'add_task',
	'complexity_report',
	'dependency_analysis'
];

/** TASKGRAPH_TOOLS trimmed, or 'core' when it is unset or blank */
export function getToolsConfiguration(): string {
	const rawValue = process.env.TASKGRAPH_TOOLS;

	if (!rawValue || rawValue.trim() === '') {
		logger.debug('No TASKGRAPH_TOOLS env var found, defaulting to "core"');
		return 'core';
	}

	const normalizedValue = rawValue.trim();
	logger.debug(`TASKGRAPH_TOOLS env var: "${normalizedValue}"`);
	return normalizedValue;
}

/**
 * The registry name a TASKGRAPH_TOOLS entry means: the name in any case, or
 * with `_` and `-` swapped (so `response_language` is `response-language`).
 */
function resolveToolName(toolName: string): string | null {
	const lower = toolName.toLowerCase();
	const candidates = [
		lower,
		lower.replace(/_/g, '-'),
		lower.replace(/-/g, '_')
	];
	for (const candidate of candidates) {
		const match = Object.keys(toolRegistry).find(
			(key) => key.toLowerCase() === candidate
		);
		if (match) return match;
	}
	return null;
}

/**
 * The tools a TASKGRAPH_TOOLS value names. Throws, naming the bad entries, when
 * the value is not a tier and any entry is not a tool, so a typo stops startup
 * instead of loading a different set of tools than the user asked for.
 */
function selectTools(enabledTools: string): string[] {
	switch (enabledTools.toLowerCase()) {
		case 'all':
			logger.warn(
				'TASKGRAPH_TOOLS=all registers every tool and gives the MCP host full project control. Prefer core or standard.'
			);
			return Object.keys(toolRegistry);
		case 'core':
		case 'lean':
			logger.info('Loading core tools only');
			return coreTools;
		case 'standard':
			logger.info('Loading standard tools');
			return standardTools;
	}

	const requestedTools = enabledTools
		.split(',')
		.map((t) => t.trim())
		.filter((t) => t.length > 0);
	const uniqueTools = new Set<string>();
	const unknownTools: string[] = [];

	for (const toolName of requestedTools) {
		const resolvedName = resolveToolName(toolName);
		if (resolvedName) {
			uniqueTools.add(resolvedName);
			logger.debug(`Resolved tool "${toolName}" to "${resolvedName}"`);
		} else {
			unknownTools.push(toolName);
		}
	}

	if (unknownTools.length > 0 || uniqueTools.size === 0) {
		// JSON.stringify escapes control characters from the env value
		const problem =
			unknownTools.length > 0
				? `names unknown tiers or tools: ${unknownTools.map((t) => JSON.stringify(t)).join(', ')}`
				: `names no tools: ${JSON.stringify(enabledTools)}`;
		throw new Error(
			`TASKGRAPH_TOOLS ${problem}. Set it to a tier (core, standard, all; lean is core) or a comma-separated list of tool names, such as "get_tasks,next_task", in your MCP client's config.`
		);
	}
	logger.info(`Loading ${uniqueTools.size} custom tools from list`);
	return Array.from(uniqueTools);
}

/**
 * Register the tools a TASKGRAPH_TOOLS value names: `all`, `core` (or
 * `lean`, the default), `standard`, or a comma-separated list of tool names.
 * `all` gives the MCP host full project control; prefer `core` or `standard`.
 * Throws on a value that names an unknown tier or tool (see selectTools).
 */
export function registerTaskGraphTools(server: FastMCP, toolMode = 'core') {
	const registeredTools: string[] = [];
	const failedTools: string[] = [];
	const enabledTools = toolMode.trim();
	const toolsToRegister = selectTools(enabledTools);

	logger.info(
		`Registering ${toolsToRegister.length} MCP tools (mode: ${enabledTools})`
	);

	for (const toolName of toolsToRegister) {
		try {
			toolRegistry[toolName](server);
			logger.debug(`Registered tool: ${toolName}`);
			registeredTools.push(toolName);
		} catch (error) {
			const message = (error as Error).message;
			if (message?.includes('already registered')) {
				logger.debug(`Tool ${toolName} already registered, skipping`);
				registeredTools.push(toolName);
			} else {
				logger.error(`Failed to register tool ${toolName}: ${message}`);
				failedTools.push(toolName);
			}
		}
	}

	logger.info(
		`Successfully registered ${registeredTools.length}/${toolsToRegister.length} tools`
	);

	return {
		registeredTools,
		failedTools,
		normalizedMode: enabledTools.toLowerCase()
	};
}
