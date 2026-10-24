/**
 * @fileoverview Tasks MCP tools index
 * Exports all task-related tool registration functions
 */

export { registerAddNoteTool } from './add-note.tool.js';
export { registerAddSubtaskTool } from './add-subtask.tool.js';
export { registerAddTaskTool } from './add-task.tool.js';
export { registerArchiveTasksTool } from './archive.tool.js';
export { registerExpandAllTool, registerExpandTaskTool } from './expand.tool.js';
export {
	registerAddDependencyTool,
	registerFixDependenciesTool,
	registerRemoveDependencyTool,
	registerValidateDependenciesTool
} from './dependencies.tool.js';
export { registerDependencyAnalysisTool } from './dependency-analysis.tool.js';
export { registerGetTasksTool } from './get-tasks.tool.js';
export { registerGetTaskTool } from './get-task.tool.js';
export { registerGenerateTool } from './generate.tool.js';
export { registerMoveTaskTool } from './move-task.tool.js';
export { registerSetTaskStatusTool } from './set-task-status.tool.js';
export {
	registerClearSubtasksTool,
	registerRemoveSubtaskTool,
	registerRemoveTaskTool
} from './removal.tool.js';
