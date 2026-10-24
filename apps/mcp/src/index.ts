/**
 * @fileoverview Main entry point for @tm/mcp package
 * Exports all MCP tool registration functions
 */

export * from './tools/github/index.js';
export * from './tools/tasks/index.js';
export * from './tools/tags/index.js';
export * from './tools/settings/index.js';
export * from './tools/setup/index.js';
export * from './shared/utils.js';
export * from './shared/types.js';
export { SERVER_INSTRUCTIONS, TaskGraphMCPServer } from './server.js';
export {
	coreTools,
	registerTaskGraphTools,
	standardTools,
	toolRegistry
} from './tools/tool-registry.js';
