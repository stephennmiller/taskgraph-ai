/**
 * @fileoverview Zod schemas for task ID validation
 * Provides type-safe validation of task IDs
 *
 * Task ID Formats:
 * - Main tasks: "1", "2", "3" (numeric only)
 * - Subtasks: "1.1", "1.2" (one level only, no "1.2.3")
 */

import { z } from 'zod';

/**
 * Pattern for a main task: "1", "2", "123"
 */
const MAIN_PATTERN = /^\d+$/;

/**
 * Pattern for a subtask: "1.1", "2.3" (exactly one dot, one level)
 */
const SUBTASK_PATTERN = /^\d+\.\d+$/;

/**
 * Check if a task ID format is valid
 * Accepts: "1", "1.1"
 * Rejects: "1.2.3", "ABC-1"
 */
function isValidTaskIdFormat(id: string): boolean {
	if (!id) return false;
	const trimmed = id.trim();
	return MAIN_PATTERN.test(trimmed) || SUBTASK_PATTERN.test(trimmed);
}

/**
 * Check if a task ID is a main task (not a subtask)
 * Main tasks: "1", "2"
 * Subtasks: "1.1", "2.3"
 */
function isMainTask(taskId: string): boolean {
	if (!taskId) return false;
	return MAIN_PATTERN.test(taskId.trim());
}

/**
 * Zod schema for any task ID (main task or subtask)
 * Safe to use in MCP tool schemas (no transform)
 *
 * @example
 * ```typescript
 * TaskIdSchema.safeParse('1');       // { success: true, data: '1' }
 * TaskIdSchema.safeParse('1.2');     // { success: true, data: '1.2' }
 * TaskIdSchema.safeParse('1.2.3');   // { success: false } - too deep
 * TaskIdSchema.safeParse('ABC-1');   // { success: false } - not numeric
 * ```
 */
export const TaskIdSchema = z.string().trim().refine(isValidTaskIdFormat, {
	message: 'Invalid task ID format. Expected numeric ("1") or subtask ("1.2")'
});

/**
 * Zod schema for main task IDs only (no subtasks)
 * Safe to use in MCP tool schemas (no transform)
 *
 * @example
 * ```typescript
 * MainTaskIdSchema.safeParse('1');     // { success: true, data: '1' }
 * MainTaskIdSchema.safeParse('1.2');   // { success: false } - subtask
 * ```
 */
export const MainTaskIdSchema = z
	.string()
	.trim()
	.refine(isValidTaskIdFormat, {
		message: 'Invalid task ID format. Expected numeric ("1")'
	})
	.refine(isMainTask, {
		message:
			'Subtask IDs are not allowed. Please provide a main task ID (e.g., "1")'
	});

/**
 * Type for a validated task ID
 */
export type TaskId = z.output<typeof TaskIdSchema>;

/**
 * Type for a validated main task ID
 */
export type MainTaskId = z.output<typeof MainTaskIdSchema>;
