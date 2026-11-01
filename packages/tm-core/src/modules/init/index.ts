/**
 * @fileoverview Setting up a project: `taskgraph init` and the MCP
 * `initialize_project` tool
 */

export {
	type InitPlan,
	type InitProblem,
	type InitProjectOptions,
	type InitProjectResult,
	initializeProject,
	planInit,
	resolveStoreTasksInGit,
	setUpMergeDriver
} from './init.service.js';
export {
	RULE_PROFILES,
	type RulesProfile,
	findInvalidRulesProfiles
} from './claude-code.js';
export { GITATTRIBUTES_FILE, type InitChange } from './init-changes.js';
