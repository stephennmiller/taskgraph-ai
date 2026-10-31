/**
 * @fileoverview Dependency views of the tasks domain: the dependency tree,
 * bottlenecks and blockers, and the session context for `taskgraph prime`.
 * TasksDomain exposes each one as `tmCore.tasks.<name>`.
 */

import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TaskService } from './services/task-service.js';
import {
	analyzeDependencies,
	buildDependencyTree,
	explainBlockers,
	type DependencyAnalysis,
	type BlockerExplanation,
	type DependencyTree
} from '../dependencies/index.js';
import { buildPrimeContext, type PrimeContext } from './utils/prime-context.js';
import { normalizeTaskId } from './validation/task-id.js';

/** Read-only dependency views behind TasksDomain */
export class TaskDependencyViews {
	constructor(
		private taskService: TaskService,
		private configManager: ConfigManager
	) {}

	/**
	 * Lay tasks out as a dependency tree for display (each task once, under
	 * its deepest dependency). Pass rootId for one task and what depends on it.
	 * Throws NOT_FOUND for a tag the project doesn't have.
	 */
	async getDependencyTree(
		options: { tag?: string; rootId?: string } = {}
	): Promise<DependencyTree> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return buildDependencyTree(tasks, { rootId: options.rootId });
	}

	/**
	 * Bottlenecks (top 5 unless limit is set), critical path and dependency
	 * cycles for a tag's tasks. With taskId, also explains what blocks that
	 * task (see explainBlockers) from the same task list. Throws NOT_FOUND for
	 * a tag the project doesn't have.
	 */
	async analyzeDependencies(
		options: { tag?: string; limit?: number; taskId?: string } = {}
	): Promise<DependencyAnalysis> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return analyzeDependencies(tasks, {
			limit: options.limit,
			id: options.taskId
		});
	}

	/**
	 * Explain why a task can't be started: its unfinished dependencies, down
	 * to the root causes (ready work, stalled tasks, missing IDs, cycles).
	 * Works for subtask IDs like "2.1"; a subtask also waits on its parent's
	 * dependencies. Throws if the task or the named tag doesn't exist.
	 */
	async explainBlockers(
		taskId: string,
		options: { tag?: string } = {}
	): Promise<BlockerExplanation> {
		const tasks = await this.taskService.getDependencyView(options.tag);
		return explainBlockers(tasks, normalizeTaskId(taskId));
	}

	/**
	 * Session context for a coding agent (`taskgraph prime`): the task in
	 * progress with its done-when criteria, the next three ready tasks in
	 * `next` order, and the workflow rules. Uses the active tag by default.
	 * An active tag tasks.json doesn't have gives an empty context with
	 * `tagMissing`, so session start still gets the rules.
	 */
	async getPrimeContext(options: { tag?: string } = {}): Promise<PrimeContext> {
		const activeTag = this.configManager.getActiveTag();
		const tag = options.tag || activeTag;
		if (tag === activeTag && !(await this.taskService.tagExists(tag))) {
			return { ...buildPrimeContext([], { tag }), tagMissing: true };
		}
		const tasks = await this.taskService.getDependencyView(tag);
		return buildPrimeContext(tasks, { tag });
	}
}
