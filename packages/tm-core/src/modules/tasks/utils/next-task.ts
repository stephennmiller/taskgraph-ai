/**
 * @fileoverview Next-task selection
 * One rule for which task or subtask to work on next, shared by the service
 * and the legacy scripts so the CLI, MCP and list view never disagree.
 */

import type { Task } from '../../../common/types/index.js';
import {
	blockedCount,
	blockedWithinTask,
	buildDependencyGraph,
	resolveSubtaskDependency
} from '../../dependencies/index.js';
import { createDependencyState } from '../../dependencies/dependency-check.js';
import { subtaskInContext } from './subtask-context.js';

export interface SelectNextTaskOptions {
	/**
	 * Only pick work nobody has started: skip items already in progress. Used
	 * by claims, so two sessions never get the same task.
	 */
	unstartedOnly?: boolean;
}

/**
 * Prefers an eligible subtask of an in-progress task (its own and its
 * parent's dependencies satisfied), then the best
 * top-level task: priority, then how much work it unblocks (in top-level
 * tasks; between subtasks, then how much of their own task), then fewest
 * dependencies, then lowest id.
 * @returns The next item, or null when nothing is eligible
 */
export function selectNextTask(
	tasks: Task[],
	options: SelectNextTaskOptions = {}
): Task | null {
	return rankNextTasks(tasks, options)[0] ?? null;
}

/**
 * Every eligible item in `next` order: subtasks of in-progress tasks first,
 * then top-level tasks, each group ranked as selectNextTask describes. The
 * first item is what selectNextTask returns. Subtasks carry dotted IDs
 * ("3.2") and a parentId.
 */
export function rankNextTasks(
	tasks: Task[],
	options: SelectNextTaskOptions = {}
): Task[] {
	const pickable = (status: string) =>
		status === 'pending' ||
		(status === 'in-progress' && !options.unstartedOnly);
	const graph = buildDependencyGraph(tasks);
	const blockedCounts = blockedCount(tasks, graph);
	const blocks = (task: Task) => blockedCounts.get(String(task.id)) ?? 0;
	const siblingCounts = blockedWithinTask(tasks, graph);
	const blocksSiblings = (task: Task) =>
		siblingCounts.get(String(task.id)) ?? 0;
	const priorityValues = { critical: 4, high: 3, medium: 2, low: 1 };

	// Same rule as `why` and `graph`; sees every task, so a done subtask of a
	// task in review counts as done
	const dependencyState = createDependencyState(tasks);
	const satisfied = (taskId: string, depId: unknown) =>
		dependencyState(taskId, String(depId)) === 'satisfied';

	// 1) Look for eligible subtasks from in-progress parent tasks
	const candidateSubtasks: Array<Task & { parentId?: string }> = [];

	tasks
		.filter((t) => t.status === 'in-progress' && Array.isArray(t.subtasks))
		.forEach((parent) => {
			// A subtask also waits on what its parent waits on (not on the
			// parent listing itself), as `why` shows it
			const parentId = String(parent.id);
			const parentDepsSatisfied = (parent.dependencies ?? [])
				.map(String)
				.filter((depId) => depId !== parentId)
				.every((depId) => satisfied(parentId, depId));
			if (!parentDepsSatisfied) return;
			parent.subtasks!.forEach((st) => {
				const stStatus = (st.status || 'pending').toLowerCase();
				if (!pickable(stStatus)) return;

				const fullDeps =
					st.dependencies?.map((d) => resolveSubtaskDependency(parent.id, d)) ??
					[];
				const depsSatisfied =
					fullDeps.length === 0 ||
					fullDeps.every((depId) => satisfied(`${parentId}.${st.id}`, depId));

				if (depsSatisfied) {
					candidateSubtasks.push({
						...subtaskInContext(parent, st),
						dependencies: fullDeps,
						subtasks: []
					} as Task & { parentId: string });
				}
			});
		});

	// Sort by priority → blocked count → work of the same task it holds up →
	// dependency count → parent ID → subtask ID
	candidateSubtasks.sort((a, b) => {
		const pa = priorityValues[a.priority as keyof typeof priorityValues] ?? 2;
		const pb = priorityValues[b.priority as keyof typeof priorityValues] ?? 2;
		if (pb !== pa) return pb - pa;

		if (blocks(a) !== blocks(b)) return blocks(b) - blocks(a);

		if (blocksSiblings(a) !== blocksSiblings(b)) {
			return blocksSiblings(b) - blocksSiblings(a);
		}

		if (a.dependencies!.length !== b.dependencies!.length) {
			return a.dependencies!.length - b.dependencies!.length;
		}

		// Compare parent then subtask ID numerically
		const [aPar, aSub] = String(a.id).split('.').map(Number);
		const [bPar, bSub] = String(b.id).split('.').map(Number);
		if (aPar !== bPar) return aPar - bPar;
		return aSub - bSub;
	});

	// 2) Then top-level tasks
	const eligibleTasks = tasks.filter((task) => {
		const status = (task.status || 'pending').toLowerCase();
		if (!pickable(status)) return false;

		const deps = task.dependencies ?? [];
		return deps.every((depId) => satisfied(String(task.id), depId));
	});

	// Sort by priority → blocked count → dependency count → task ID
	eligibleTasks.sort((a, b) => {
		const pa = priorityValues[a.priority as keyof typeof priorityValues] ?? 2;
		const pb = priorityValues[b.priority as keyof typeof priorityValues] ?? 2;
		if (pb !== pa) return pb - pa;

		if (blocks(a) !== blocks(b)) return blocks(b) - blocks(a);

		const da = (a.dependencies ?? []).length;
		const db = (b.dependencies ?? []).length;
		if (da !== db) return da - db;

		return Number(a.id) - Number(b.id);
	});

	return [...candidateSubtasks, ...eligibleTasks];
}
