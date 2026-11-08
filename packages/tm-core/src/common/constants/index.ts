/**
 * @fileoverview Constants for TaskGraph Core
 * Single source of truth for all constant values
 */

import type {
	TaskComplexity,
	TaskPriority,
	TaskStatus
} from '../types/index.js';
import { ERROR_CODES, TaskGraphError } from '../errors/taskgraph-error.js';

// Import from root package.json (monorepo root) for version info
import packageJson from '../../../../../package.json' with { type: 'json' };

/**
 * TaskGraph version from root package.json
 * Centralized to avoid fragile relative paths throughout the codebase
 */
export const TASKGRAPH_VERSION = packageJson.version || 'unknown';

/**
 * Package name from root package.json
 */
export const PACKAGE_NAME = packageJson.name || 'taskgraph-ai';

/** npm spec pinned to this version, so a committed config can't drift to `latest` */
export const TASKGRAPH_PACKAGE = `${PACKAGE_NAME}@${TASKGRAPH_VERSION}`;

/**
 * Node versions the package supports, from root package.json's `engines`
 */
export const NODE_VERSION_RANGE: string = packageJson.engines?.node ?? '';

/** What a status means to each part of TaskGraph; one row per TaskStatus */
interface TaskStatusMeaning {
	/** Finished: satisfies dependencies, counts toward completion, never picked by `next` */
	complete: boolean;
	/** `next` may pick it (a claim picks in-progress only when its claim is stale) */
	pickable: boolean;
	/** Kept by the actionable list filter: can be worked on once dependencies are met */
	actionable: boolean;
	/** A loop run counts a move to this status as the task completed (#812) */
	finished: boolean;
	/** analyze-complexity scores tasks in this status */
	active: boolean;
	/** The GitHub issue stays open, with this status as a label */
	open: boolean;
	/** A parallel container worker may hand its task back in this status; not done, the work is unmerged */
	importable: boolean;
}

/** Every status and what it means. Key order is TASK_STATUSES order. */
export const TASK_STATUS_MEANINGS = {
	pending: {
		complete: false,
		pickable: true,
		actionable: true,
		finished: false,
		active: true,
		open: true,
		importable: false
	},
	'in-progress': {
		complete: false,
		pickable: true,
		actionable: true,
		finished: false,
		active: true,
		open: true,
		importable: false
	},
	done: {
		complete: true,
		pickable: false,
		actionable: false,
		finished: true,
		active: false,
		open: false,
		importable: false
	},
	deferred: {
		complete: false,
		pickable: false,
		actionable: false,
		finished: false,
		active: false,
		open: true,
		importable: false
	},
	cancelled: {
		complete: true,
		pickable: false,
		actionable: false,
		finished: false,
		active: false,
		open: false,
		importable: false
	},
	blocked: {
		complete: false,
		pickable: false,
		actionable: false,
		finished: false,
		active: true,
		open: true,
		importable: true
	},
	review: {
		complete: false,
		pickable: false,
		actionable: true,
		finished: true,
		active: false,
		open: true,
		importable: true
	}
} as const satisfies Record<TaskStatus, TaskStatusMeaning>;

/**
 * Valid task status values
 */
export const TASK_STATUSES = Object.keys(
	TASK_STATUS_MEANINGS
) as readonly TaskStatus[];

/** The statuses whose row has `meaning` set, in TASK_STATUSES order */
export function statusesWhere(
	meaning: keyof TaskStatusMeaning
): readonly TaskStatus[] {
	return TASK_STATUSES.filter((s) => TASK_STATUS_MEANINGS[s][meaning]);
}

/**
 * Throws a VALIDATION_ERROR unless `status` is one of TASK_STATUSES.
 * TaskStatus is compile-time only; MCP, GitHub sync and JS callers pass raw strings
 */
export function assertTaskStatus(
	status: unknown,
	details?: Record<string, unknown>
): asserts status is TaskStatus {
	if (!TASK_STATUSES.includes(status as TaskStatus)) {
		throw new TaskGraphError(
			// JSON.stringify escapes control characters a raw string could carry
			`${JSON.stringify(status)} isn't a status. Use one of: ${TASK_STATUSES.join(', ')}`,
			ERROR_CODES.VALIDATION_ERROR,
			details
		);
	}
}

/**
 * Terminal complete statuses - tasks that are finished and satisfy dependencies
 * These statuses indicate a task is in a final state and:
 * - Should count toward completion percentage
 * - Should be considered satisfied for dependency resolution
 * - Should not be selected as "next task"
 */
export const TERMINAL_COMPLETE_STATUSES = statusesWhere('complete');

/**
 * Check if a task status represents a terminal complete state
 *
 * @param status - The task status to check
 * @returns true if the status represents a completed/terminal task
 *
 * @example
 * ```typescript
 * isTaskComplete('done')      // true
 * isTaskComplete('cancelled') // true
 * isTaskComplete('pending')   // false
 * ```
 */
export function isTaskComplete(status: TaskStatus): boolean {
	return TERMINAL_COMPLETE_STATUSES.includes(status);
}

/**
 * Valid task priority values
 */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
	'low',
	'medium',
	'high',
	'critical'
] as const;

/**
 * Valid task complexity values
 */
export const TASK_COMPLEXITIES: readonly TaskComplexity[] = [
	'simple',
	'moderate',
	'complex',
	'very-complex'
] as const;

/**
 * Valid output formats for task display
 */
export const OUTPUT_FORMATS = ['text', 'json', 'compact'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

/**
 * Status icons for display
 */
export const STATUS_ICONS: Record<TaskStatus, string> = {
	done: '✓',
	'in-progress': '►',
	blocked: '⭕',
	pending: '○',
	deferred: '⏸',
	cancelled: '✗',
	review: '👁'
} as const;

/**
 * Status colors for display (using chalk color names)
 */
export const STATUS_COLORS: Record<TaskStatus, string> = {
	pending: 'yellow',
	'in-progress': 'blue',
	done: 'green',
	deferred: 'dim',
	cancelled: 'red',
	blocked: 'magenta',
	review: 'cyan'
} as const;

/**
 * Provider constants - AI model providers
 */
export * from './providers.js';

/**
 * Path constants - file paths and directory structure
 */
export * from './paths.js';

/** Env vars that stop a child process from installing an update */
export * from './auto-update.js';
