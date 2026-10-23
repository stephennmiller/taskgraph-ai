/**
 * @fileoverview Task ID validation utilities and Zod schemas
 * Provides validation for task IDs used in MCP tools and CLI
 *
 * Supported formats:
 * - Main tasks: "1", "2", "15"
 * - Subtasks: "1.2", "15.3"
 * - Sub-subtasks: "1.2.3", "15.3.1"
 */

import { z } from 'zod';

/**
 * Pattern for validating a single task ID
 * - Numeric: "1", "15", "999"
 * - Numeric subtasks: "1.2", "1.2.3" (multi-level supported)
 */
export const TASK_ID_PATTERN = /^\d+(\.\d+)*$/;

/**
 * Validates a single task ID string
 *
 * @param id - The task ID to validate
 * @returns True if the ID is valid
 *
 * @example
 * ```typescript
 * isValidTaskIdFormat("1");        // true
 * isValidTaskIdFormat("1.2");      // true
 * isValidTaskIdFormat("1.2.3");    // true (multi-level subtasks)
 * isValidTaskIdFormat("ABC-1");    // false (prefixed IDs are not supported)
 * isValidTaskIdFormat("abc");      // false
 * ```
 */
export function isValidTaskIdFormat(id: string): boolean {
	return TASK_ID_PATTERN.test(id);
}

/**
 * Zod schema for a single task ID
 * Validates format: numeric task or numeric subtask
 * This schema is used in MCP tool definitions which can't have transforms.
 */
export const taskIdSchema = z
	.string()
	.min(1, 'Task ID cannot be empty')
	.refine(isValidTaskIdFormat, {
		message:
			"Invalid task ID format. Expected numeric (e.g., '15') or subtask (e.g., '15.2')"
	});

/**
 * Zod schema for comma-separated task IDs
 * Validates that each ID in the comma-separated list is valid
 *
 * @example
 * ```typescript
 * taskIdsSchema.parse("1");        // valid
 * taskIdsSchema.parse("1,2,3");    // valid
 * taskIdsSchema.parse("1.2, 3.4"); // valid (spaces trimmed)
 * taskIdsSchema.parse("abc");      // throws
 * taskIdsSchema.parse("ABC-123");  // throws (prefixed IDs are not supported)
 * ```
 */
export const taskIdsSchema = z
	.string()
	.min(1, 'Task ID(s) cannot be empty')
	.refine(
		(value) => {
			const ids = value
				.split(',')
				.map((id) => id.trim())
				.filter((id) => id.length > 0);
			return ids.length > 0 && ids.every(isValidTaskIdFormat);
		},
		{
			message:
				"Invalid task ID format. Expected numeric (e.g., '15') or subtask (e.g., '15.2'). Multiple IDs should be comma-separated."
		}
	);

/**
 * Parse and validate comma-separated task IDs
 *
 * @param input - Comma-separated task ID string
 * @returns Array of validated task IDs
 * @throws Error if any ID is invalid
 *
 * @example
 * ```typescript
 * parseTaskIds("1, 2, 3");     // ["1", "2", "3"]
 * parseTaskIds("1.2,3.4");     // ["1.2", "3.4"]
 * parseTaskIds("invalid");     // throws Error
 * parseTaskIds("ABC-123");     // throws Error (prefixed IDs are not supported)
 * ```
 */
export function parseTaskIds(input: string): string[] {
	const ids = input
		.split(',')
		.map((id) => id.trim())
		.filter((id) => id.length > 0);

	if (ids.length === 0) {
		throw new Error('No valid task IDs provided');
	}

	const invalidIds = ids.filter((id) => !isValidTaskIdFormat(id));
	if (invalidIds.length > 0) {
		throw new Error(
			`Invalid task ID format: ${invalidIds.join(', ')}. Expected numeric (e.g., '15') or subtask (e.g., '15.2')`
		);
	}

	return ids;
}

/**
 * Extract parent task ID from a subtask ID
 *
 * @param taskId - Task ID (e.g., "1.2.3")
 * @returns Parent ID (e.g., "1") or the original ID if not a subtask
 *
 * @example
 * ```typescript
 * extractParentId("1.2.3");  // "1"
 * extractParentId("1.2");    // "1"
 * extractParentId("1");      // "1"
 * ```
 */
export function extractParentId(taskId: string): string {
	const parts = taskId.split('.');
	return parts[0];
}

/**
 * Check if a task ID represents a subtask
 *
 * @param taskId - Task ID to check
 * @returns True if the ID contains a dot (subtask notation)
 *
 * @example
 * ```typescript
 * isSubtaskId("1.2");   // true
 * isSubtaskId("1.2.3"); // true
 * isSubtaskId("1");     // false
 * ```
 */
export function isSubtaskId(taskId: string): boolean {
	return taskId.includes('.');
}

/**
 * The full dotted ID of a subtask. Stored subtasks usually carry only their
 * own number (`2`), but some already hold the dotted form (`"3.2"`).
 *
 * @example
 * ```typescript
 * fullSubtaskId(3, 2);     // "3.2"
 * fullSubtaskId(3, "3.2"); // "3.2"
 * ```
 */
export function fullSubtaskId(
	parentId: string | number,
	subtaskId: string | number
): string {
	const id = String(subtaskId);
	return isSubtaskId(id) ? id : `${parentId}.${id}`;
}
