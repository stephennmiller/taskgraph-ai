/**
 * @fileoverview Slash Commands Module
 * Central exports for the slash command system.
 */

// Types
export type {
	SlashCommand,
	StaticSlashCommand,
	DynamicSlashCommand,
	SlashCommandMetadata,
	FormattedSlashCommand
} from './types.js';

// Factory functions
export { staticCommand, dynamicCommand } from './factories.js';
export type { StaticCommandOptions } from './factories.js';

// Commands
export { allCommands, goham } from './commands/index.js';

// Profiles - self-contained profile classes
export {
	// Base class
	BaseSlashCommandProfile,
	// Profile classes (Claude Code)
	ClaudeProfile,
	// Utility functions
	getProfile,
	getAllProfiles,
	getProfileNames
} from './profiles/index.js';

// Profile types
export type { SlashCommandResult } from './profiles/index.js';

// Utilities
export { resolveProjectRoot } from './utils.js';
