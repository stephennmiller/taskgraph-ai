/**
 * @fileoverview Counts behind the summary `taskgraph list` prints above its
 * table: tasks and subtasks by status, and how many are ready to start
 */

import { isTaskComplete } from '../../../common/constants/index.js';
import type { Task, TaskStatus } from '../../../common/types/index.js';
import { ACTIONABLE_STATUSES, filterReadyTasks } from './task-filters.js';

/**
 * Statistics for task collection
 */
export interface TaskStatistics {
	total: number;
	done: number;
	inProgress: number;
	pending: number;
	blocked: number;
	deferred: number;
	cancelled: number;
	review?: number;
	completionPercentage: number;
	/** Count of all terminal complete tasks (done + completed + cancelled) */
	completedCount: number;
}

/**
 * Statistics for dependencies
 */
export interface DependencyStatistics {
	/** Tasks `list --ready` shows */
	tasksReadyToWork: number;
	/** Workable tasks (pending, in progress, review) a dependency holds up */
	tasksBlockedByDeps: number;
	mostDependedOnTaskId?: string;
	mostDependedOnCount?: number;
}

function countStatuses(statuses: TaskStatus[]): TaskStatistics {
	const count = (status: TaskStatus) =>
		statuses.filter((s) => s === status).length;
	const completedCount = statuses.filter(isTaskComplete).length;
	return {
		total: statuses.length,
		done: count('done'),
		inProgress: count('in-progress'),
		pending: count('pending'),
		blocked: count('blocked'),
		deferred: count('deferred'),
		cancelled: count('cancelled'),
		review: count('review'),
		completedCount,
		completionPercentage:
			statuses.length > 0
				? Math.round((completedCount / statuses.length) * 100)
				: 0
	};
}

/**
 * Calculate task statistics from a list of tasks
 */
export function calculateTaskStatistics(tasks: Task[]): TaskStatistics {
	return countStatuses(tasks.map((t) => t.status));
}

/**
 * Calculate subtask statistics from tasks
 */
export function calculateSubtaskStatistics(tasks: Task[]): TaskStatistics {
	return countStatuses(
		tasks.flatMap((t) => (t.subtasks ?? []).map((s) => s.status ?? 'pending'))
	);
}

/**
 * How many tasks are ready, by the rule `next` and `list --ready` use
 * (`createDependencyState`), and the task most others depend on
 * @param tasks - A tag's tasks, archived dependencies already satisfied
 *   (`satisfyArchivedDependencies`)
 */
export function calculateDependencyStatistics(
	tasks: Task[]
): DependencyStatistics {
	const ready = filterReadyTasks(tasks).length;
	const workable = tasks.filter((t) =>
		ACTIONABLE_STATUSES.includes(t.status)
	).length;

	const dependencyCount = new Map<string, number>();
	for (const depId of tasks.flatMap((t) => t.dependencies ?? [])) {
		const key = String(depId);
		dependencyCount.set(key, (dependencyCount.get(key) ?? 0) + 1);
	}
	let mostDependedOnTaskId: string | undefined;
	let mostDependedOnCount = 0;
	for (const [taskId, count] of dependencyCount) {
		if (count > mostDependedOnCount) {
			mostDependedOnCount = count;
			mostDependedOnTaskId = taskId;
		}
	}

	return {
		tasksReadyToWork: ready,
		tasksBlockedByDeps: workable - ready,
		mostDependedOnTaskId,
		mostDependedOnCount
	};
}
