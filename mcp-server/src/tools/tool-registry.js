/**
 * tool-registry.js
 * Tool Registry - Maps tool names to registration functions
 */

// Import TypeScript tools from apps/mcp
import {
	registerAddDependencyTool,
	registerAddNoteTool,
	registerAddTaskTool,
	registerAddTagTool,
	registerAddSubtaskTool,
	registerArchiveTasksTool,
	registerClearSubtasksTool,
	registerCopyTagTool,
	registerExpandAllTool,
	registerExpandTaskTool,
	registerDeleteTagTool,
	registerDependencyAnalysisTool,
	registerFixDependenciesTool,
	registerGenerateTool,
	registerGetTasksTool,
	registerGetTaskTool,
	registerGithubPushTool,
	registerGithubStatusTool,
	registerListTagsTool,
	registerMoveTaskTool,
	registerRemoveDependencyTool,
	registerRemoveSubtaskTool,
	registerRemoveTaskTool,
	registerRenameTagTool,
	registerResearchTool,
	registerSetTaskStatusTool,
	registerUseTagTool,
	registerValidateDependenciesTool
} from '@tm/mcp';
import { registerAnalyzeProjectComplexityTool } from './analyze.js';
import { registerComplexityReportTool } from './complexity-report.js';
import { registerInitializeProjectTool } from './initialize-project.js';
import { registerModelsTool } from './models.js';
import { registerNextTaskTool } from './next-task.js';
import { registerParsePRDTool } from './parse-prd.js';
import { registerResponseLanguageTool } from './response-language.js';
import { registerScopeDownTool } from './scope-down.js';
import { registerScopeUpTool } from './scope-up.js';
import { registerUpdateTool } from './update.js';
import { registerUpdateSubtaskTool } from './update-subtask.js';
import { registerUpdateTaskTool } from './update-task.js';

/**
 * Comprehensive tool registry mapping tool names to their registration functions
 * Used for dynamic tool registration and validation
 */
export const toolRegistry = {
	initialize_project: registerInitializeProjectTool,
	models: registerModelsTool,
	parse_prd: registerParsePRDTool,
	'response-language': registerResponseLanguageTool,
	analyze_project_complexity: registerAnalyzeProjectComplexityTool,
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

/**
 * Core tools array containing the 7 essential tools for daily development
 * These represent the minimal set needed for basic task management operations
 */
export const coreTools = [
	'get_tasks',
	'next_task',
	'get_task',
	'set_task_status',
	'add_note',
	'parse_prd',
	'expand_task'
];

/**
 * Standard tools array containing the 16 most commonly used tools
 * Includes all core tools plus frequently used additional tools
 */
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

/**
 * Get all available tool names
 * @returns {string[]} Array of tool names
 */
export function getAvailableTools() {
	return Object.keys(toolRegistry);
}

/**
 * Get tool counts for all categories
 * @returns {Object} Object with core, standard, and total counts
 */
export function getToolCounts() {
	return {
		core: coreTools.length,
		standard: standardTools.length,
		total: Object.keys(toolRegistry).length
	};
}

/**
 * Get tool arrays organized by category
 * @returns {Object} Object with arrays for each category
 */
export function getToolCategories() {
	const allTools = Object.keys(toolRegistry);
	return {
		core: [...coreTools],
		standard: [...standardTools],
		all: [...allTools],
		extended: allTools.filter((t) => !standardTools.includes(t))
	};
}

/**
 * Get registration function for a specific tool
 * @param {string} toolName - Name of the tool
 * @returns {Function|null} Registration function or null if not found
 */
export function getToolRegistration(toolName) {
	return toolRegistry[toolName] || null;
}

/**
 * Validate if a tool exists in the registry
 * @param {string} toolName - Name of the tool
 * @returns {boolean} True if tool exists
 */
export function isValidTool(toolName) {
	return toolName in toolRegistry;
}
