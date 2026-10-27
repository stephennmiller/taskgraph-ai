/**
 * @fileoverview The `claudeCode` section of .taskgraph/config.json: its
 * schema, and the commands a `commandSpecific` entry may name.
 */

import { z } from 'zod';

/** Commands that call the AI, the keys `claudeCode.commandSpecific` accepts */
const AI_COMMAND_NAMES = [
	'add-task',
	'analyze-complexity',
	'expand-task',
	'parse-prd',
	'research',
	'research-save',
	'update-subtask',
	'update-task',
	'update-tasks'
];

// Only keys the provider still reads. TaskGraph sets the system prompt,
// tools, permission mode and MCP servers itself (see providers/claude-code.ts),
// so unknown keys are stripped rather than honored.
const BaseSettingsSchema = z.object({
	pathToClaudeCodeExecutable: z.string().optional(),
	maxTurns: z.number().int().positive().optional(),
	disallowedTools: z.array(z.string()).optional()
});

/** `claudeCode` settings; `commandSpecific` keys must be AI command names */
export const ClaudeCodeSettingsSchema = BaseSettingsSchema.extend({
	commandSpecific: z
		.record(z.string(), BaseSettingsSchema)
		.refine(
			(obj) =>
				Object.keys(obj || {}).every((k) => AI_COMMAND_NAMES.includes(k)),
			{ message: 'Invalid command name in commandSpecific' }
		)
		.optional()
});
