/**
 * @fileoverview TaskGraph Profiles Package
 * Shell utilities for the Claude Code profile. Slash commands ship only as the
 * Claude Code plugin (packages/claude-code-plugin/commands).
 */

export * from './shell-utils.js';

// Cleanup of the slash commands older `init` runs wrote
export * from './legacy-commands.js';
