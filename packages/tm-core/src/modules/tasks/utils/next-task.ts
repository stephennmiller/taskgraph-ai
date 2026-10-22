/**
 * @fileoverview Next-task selection
 * One rule for which task or subtask to work on next, shared by the service
 * and the legacy scripts so the CLI, MCP and list view never disagree.
 */

import type { Task } from '../../../common/types/index.js';
import {
	blockedCount,
	resolveSubtaskDependency
} from '../../dependencies/index.js';

// A cancelled task will never run, so work waiting on it is not held up.
// AI-written subtasks may carry the older 'completed' spelling
const isSatisfied = (status: string | undefined) =>
	status === 'done' || status === 'completed' || status === 'cancelled';

/**
 * Prefers an eligible subtask of an in-progress task, then the best
 * top-level task: priority, then how much work it unblocks, then fewest
 * dependencies, then lowest id.
 * @returns The next item, or null when nothing is eligible
 */
export function selectNextTask(tasks: Task[]): Task | null {
	// Eligibility and satisfied dependencies only see these statuses; blocked counts see every task,
	// since deferred, blocked and review tasks still wait on their dependencies
	// A hand-edited task may have no status; it counts as pending
	const allTasks = tasks.filter((t) =>
		['pending', 'in-progress', 'done', 'completed', 'cancelled'].includes(
			t.status || 'pending'
		)
	);
	const blockedCounts = blockedCount(tasks);
	const blocks = (task: Task) => blockedCounts.get(String(task.id)) ?? 0;
	const priorityValues = { critical: 4, high: 3, medium: 2, low: 1 };

	// Build satisfied IDs set (both tasks and subtasks)
	const completedIds = new Set<string>();
	allTasks.forEach((t) => {
		if (isSatisfied(t.status)) {
			completedIds.add(String(t.id));
		}
		if (Array.isArray(t.subtasks)) {
			t.subtasks.forEach((st) => {
				if (isSatisfied(st.status)) {
					completedIds.add(`${t.id}.${st.id}`);
				}
			});
		}
	});

	// 1) Look for eligible subtasks from in-progress parent tasks
	const candidateSubtasks: Array<Task & { parentId?: string }> = [];

	allTasks
		.filter((t) => t.status === 'in-progress' && Array.isArray(t.subtasks))
		.forEach((parent) => {
			parent.subtasks!.forEach((st) => {
				const stStatus = (st.status || 'pending').toLowerCase();
				if (stStatus !== 'pending' && stStatus !== 'in-progress') return;

				const fullDeps =
					st.dependencies?.map((d) =>
						resolveSubtaskDependency(parent.id, d)
					) ?? [];
				const depsSatisfied =
					fullDeps.length === 0 ||
					fullDeps.every((depId) => completedIds.has(String(depId)));

				if (depsSatisfied) {
					candidateSubtasks.push({
						id: `${parent.id}.${st.id}`,
						title: st.title || `Subtask ${st.id}`,
						status: st.status || 'pending',
						priority: st.priority || parent.priority || 'medium',
						dependencies: fullDeps,
						parentId: String(parent.id),
						description: st.description,
						details: st.details,
						testStrategy: st.testStrategy,
						subtasks: []
					} as Task & { parentId: string });
				}
			});
		});

	if (candidateSubtasks.length > 0) {
		// Sort by priority → blocked count → dependency count → parent ID → subtask ID
		candidateSubtasks.sort((a, b) => {
			const pa =
				priorityValues[a.priority as keyof typeof priorityValues] ?? 2;
			const pb =
				priorityValues[b.priority as keyof typeof priorityValues] ?? 2;
			if (pb !== pa) return pb - pa;

			if (blocks(a) !== blocks(b)) return blocks(b) - blocks(a);

			if (a.dependencies!.length !== b.dependencies!.length) {
				return a.dependencies!.length - b.dependencies!.length;
			}

			// Compare parent then subtask ID numerically
			const [aPar, aSub] = String(a.id).split('.').map(Number);
			const [bPar, bSub] = String(b.id).split('.').map(Number);
			if (aPar !== bPar) return aPar - bPar;
			return aSub - bSub;
		});

		return candidateSubtasks[0];
	}

	// 2) Fall back to top-level tasks (original logic)
	const eligibleTasks = allTasks.filter((task) => {
		const status = (task.status || 'pending').toLowerCase();
		if (status !== 'pending' && status !== 'in-progress') return false;

		const deps = task.dependencies ?? [];
		return deps.every((depId) => completedIds.has(String(depId)));
	});

	if (eligibleTasks.length === 0) return null;

	// Sort by priority → blocked count → dependency count → task ID
	const nextTask = eligibleTasks.sort((a, b) => {
		const pa = priorityValues[a.priority as keyof typeof priorityValues] ?? 2;
		const pb = priorityValues[b.priority as keyof typeof priorityValues] ?? 2;
		if (pb !== pa) return pb - pa;

		if (blocks(a) !== blocks(b)) return blocks(b) - blocks(a);

		const da = (a.dependencies ?? []).length;
		const db = (b.dependencies ?? []).length;
		if (da !== db) return da - db;

		return Number(a.id) - Number(b.id);
	})[0];

	return nextTask;
}
