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

const BaseSettingsSchema = z.object({
	pathToClaudeCodeExecutable: z.string().optional(),
	maxTurns: z.number().int().positive().optional(),
	customSystemPrompt: z.string().optional(),
	appendSystemPrompt: z.string().optional(),
	permissionMode: z
		.enum(['default', 'acceptEdits', 'plan', 'bypassPermissions'])
		.optional(),
	allowedTools: z.array(z.string()).optional(),
	disallowedTools: z.array(z.string()).optional(),
	mcpServers: z
		.record(
			z.string(),
			z.object({
				type: z.enum(['stdio', 'sse']).optional(),
				command: z.string(),
				args: z.array(z.string()).optional(),
				env: z.record(z.string(), z.string()).optional(),
				url: z.url().optional(),
				headers: z.record(z.string(), z.string()).optional()
			})
		)
		.optional()
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
