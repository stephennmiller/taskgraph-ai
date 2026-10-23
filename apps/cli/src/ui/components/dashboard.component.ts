/**
 * @fileoverview Counts behind the summary `taskgraph list` prints above its
 * table (see formatters/task-list-formatters.ts)
 */

import { isTaskComplete, type Task, type TaskStatus } from '@tm/core';

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
	tasksWithNoDeps: number;
	tasksReadyToWork: number;
	tasksBlockedByDeps: number;
	mostDependedOnTaskId?: number;
	mostDependedOnCount?: number;
	avgDependenciesPerTask: number;
}

/**
 * Calculate task statistics from a list of tasks
 */
export function calculateTaskStatistics(tasks: Task[]): TaskStatistics {
	const stats: TaskStatistics = {
		total: tasks.length,
		done: 0,
		inProgress: 0,
		pending: 0,
		blocked: 0,
		deferred: 0,
		cancelled: 0,
		review: 0,
		completionPercentage: 0,
		completedCount: 0
	};

	tasks.forEach((task) => {
		switch (task.status) {
			case 'done':
				stats.done++;
				break;
			case 'in-progress':
				stats.inProgress++;
				break;
			case 'pending':
				stats.pending++;
				break;
			case 'blocked':
				stats.blocked++;
				break;
			case 'deferred':
				stats.deferred++;
				break;
			case 'cancelled':
				stats.cancelled++;
				break;
			case 'review':
				stats.review = (stats.review || 0) + 1;
				break;
		}
	});

	// Count terminal complete tasks for percentage calculation and display
	stats.completedCount = tasks.filter((t) => isTaskComplete(t.status)).length;
	stats.completionPercentage =
		stats.total > 0
			? Math.round((stats.completedCount / stats.total) * 100)
			: 0;

	return stats;
}

/**
 * Calculate subtask statistics from tasks
 */
export function calculateSubtaskStatistics(tasks: Task[]): TaskStatistics {
	const stats: TaskStatistics = {
		total: 0,
		done: 0,
		inProgress: 0,
		pending: 0,
		blocked: 0,
		deferred: 0,
		cancelled: 0,
		review: 0,
		completionPercentage: 0,
		completedCount: 0
	};

	const allSubtasks: Array<{ status: string }> = [];
	tasks.forEach((task) => {
		if (task.subtasks && task.subtasks.length > 0) {
			task.subtasks.forEach((subtask) => {
				stats.total++;
				allSubtasks.push(subtask);
				switch (subtask.status) {
					case 'done':
						stats.done++;
						break;
					case 'in-progress':
						stats.inProgress++;
						break;
					case 'pending':
						stats.pending++;
						break;
					case 'blocked':
						stats.blocked++;
						break;
					case 'deferred':
						stats.deferred++;
						break;
					case 'cancelled':
						stats.cancelled++;
						break;
					case 'review':
						stats.review = (stats.review || 0) + 1;
						break;
				}
			});
		}
	});

	// Count terminal complete subtasks for percentage calculation and display
	stats.completedCount = allSubtasks.filter((st) =>
		isTaskComplete(st.status as TaskStatus)
	).length;
	stats.completionPercentage =
		stats.total > 0
			? Math.round((stats.completedCount / stats.total) * 100)
			: 0;

	return stats;
}

/**
 * Calculate dependency statistics
 */
export function calculateDependencyStatistics(
	tasks: Task[]
): DependencyStatistics {
	// Get all terminal complete task IDs - these satisfy dependencies
	const completedTaskIds = new Set(
		tasks.filter((t) => isTaskComplete(t.status)).map((t) => t.id)
	);

	const tasksWithNoDeps = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			(!t.dependencies || t.dependencies.length === 0)
	).length;

	const tasksWithAllDepsSatisfied = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			t.dependencies &&
			t.dependencies.length > 0 &&
			t.dependencies.every((depId) => completedTaskIds.has(depId))
	).length;

	const tasksBlockedByDeps = tasks.filter(
		(t) =>
			!isTaskComplete(t.status) &&
			t.dependencies &&
			t.dependencies.length > 0 &&
			!t.dependencies.every((depId) => completedTaskIds.has(depId))
	).length;

	// Calculate most depended-on task
	const dependencyCount: Record<string, number> = {};
	tasks.forEach((task) => {
		if (task.dependencies && task.dependencies.length > 0) {
			task.dependencies.forEach((depId) => {
				const key = String(depId);
				dependencyCount[key] = (dependencyCount[key] || 0) + 1;
			});
		}
	});

	let mostDependedOnTaskId: number | undefined;
	let mostDependedOnCount = 0;

	for (const [taskId, count] of Object.entries(dependencyCount)) {
		if (count > mostDependedOnCount) {
			mostDependedOnCount = count;
			mostDependedOnTaskId = parseInt(taskId);
		}
	}

	// Calculate average dependencies
	const totalDependencies = tasks.reduce(
		(sum, task) => sum + (task.dependencies ? task.dependencies.length : 0),
		0
	);
	const avgDependenciesPerTask =
		tasks.length > 0 ? totalDependencies / tasks.length : 0;

	return {
		tasksWithNoDeps,
		tasksReadyToWork: tasksWithNoDeps + tasksWithAllDepsSatisfied,
		tasksBlockedByDeps,
		mostDependedOnTaskId,
		mostDependedOnCount,
		avgDependenciesPerTask
	};
}
