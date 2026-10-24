/**
 * @typedef {'high' | 'medium' | 'low'} TaskPriority
 */

/**
 * Task priority options
 * @type {TaskPriority[]}
 * @description Defines possible task priorities:
 * - high: Critical tasks that need immediate attention
 * - medium: Standard priority tasks (default)
 * - low: Tasks that can be deferred or are nice-to-have
 */
export const TASK_PRIORITY_OPTIONS = ['high', 'medium', 'low'];
