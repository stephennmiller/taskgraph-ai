/**
 * @fileoverview Main entry point for @tm/cli package
 * Exports all public APIs for the CLI presentation layer
 */

// Commands
export { ListTasksCommand } from './commands/list.command.js';
export { ShowCommand } from './commands/show.command.js';
export { NextCommand } from './commands/next.command.js';
export { GraphCommand } from './commands/graph.command.js';
export { WhyCommand } from './commands/why.command.js';
export { PrimeCommand } from './commands/prime.command.js';
export { StartCommand } from './commands/start.command.js';
export { SetStatusCommand } from './commands/set-status.command.js';
export { TagsCommand } from './commands/tags.command.js';
export { LoopCommand } from './commands/loop.command.js';
export { CompletionCommand } from './commands/completion.command.js';

// Shell completion
export {
	buildCompletionSpec,
	type CommandSpec
} from './completion/spec.js';
export {
	renderCompletionScript,
	detectShell,
	SHELLS,
	type Shell
} from './completion/scripts.js';

// Command Registry
export {
	CommandRegistry,
	registerAllCommands,
	registerCommandsByCategory,
	type CommandMetadata
} from './command-registry.js';

// General utilities (error handling, auto-update, etc.)
export * from './utils/index.js';

// UI utilities - exported only via ui namespace to avoid naming conflicts
// Import via: import { ui } from '@tm/cli'; ui.displayBanner();
export * as ui from './ui/index.js';

export { runInteractiveSetup } from './commands/models/index.js';
export { collectClarifications } from './commands/parse-prd/clarify-prompts.js';

// Re-export commonly used types from tm-core
export type {
	Task,
	TaskStatus,
	TaskPriority,
	TmCore
} from '@tm/core';
