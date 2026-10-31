/**
 * @fileoverview DependencyService: add-dependency, remove-dependency,
 * validate-dependencies and fix-dependencies on a tag's tasks.json, each in
 * one locked read-modify-write (none for a check or a change that changes
 * nothing). The rules are in modules/dependencies (dependency-edit.ts and
 * dependency-check.ts); this applies them to storage.
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../../../common/constants/paths.js';
import {
	addDependencyIn,
	type AddDependencyResult,
	removeDependencyIn,
	type RemoveDependencyResult
} from '../../dependencies/dependency-edit.js';
import {
	countTasksAndDependencies,
	type DependencyCheckResult,
	type DependencyFixResult,
	fixTaskDependencies,
	validateTaskDependencies
} from '../../dependencies/dependency-check.js';
import { checkPrdCoverage } from '../../prd/prd-coverage.js';
import type { TaskService } from './task-service.js';

export class DependencyService {
	constructor(
		private readonly taskService: TaskService,
		private readonly projectRoot: string
	) {}

	/**
	 * Make a task or subtask depend on another, or with type `related` /
	 * `discovered-from` link them without blocking. Throws, changing nothing,
	 * for an unknown or archived ID, a dependency on itself, or one that would
	 * make a loop. Uses the active tag by default.
	 */
	async add(
		taskId: string,
		dependsOn: string,
		options: { tag?: string; type?: string } = {}
	): Promise<AddDependencyResult & { tag: string }> {
		const { result, tag } = await this.taskService.modifyTasks(
			(tasks, archivedIds) => {
				const added = addDependencyIn(
					tasks,
					taskId,
					dependsOn,
					archivedIds,
					options.type
				);
				return { tasks: added.changed ? tasks : null, result: added };
			},
			options.tag
		);
		return { ...result, tag };
	}

	/**
	 * Remove a dependency, or a related / discovered-from link. One the task
	 * never had changes nothing (`removed: false`); an unknown task throws.
	 */
	async remove(
		taskId: string,
		dependsOn: string,
		options: { tag?: string } = {}
	): Promise<RemoveDependencyResult & { tag: string }> {
		const { result, tag } = await this.taskService.modifyTasks((tasks) => {
			const outcome = removeDependencyIn(tasks, taskId, dependsOn);
			return { tasks: outcome.removed ? tasks : null, result: outcome };
		}, options.tag);
		return { ...result, tag };
	}

	/**
	 * Every dependency problem in a tag, without writing, with the counts for
	 * a summary and PRD coverage (null unless parse-prd recorded sources).
	 * Dependencies on archived tasks count as done.
	 */
	async validate(
		options: { tag?: string } = {}
	): Promise<DependencyCheckResult> {
		const { tasks, archivedIds } = await this.taskService.loadStoredTasks(
			options.tag
		);
		return {
			...validateTaskDependencies(tasks, archivedIds),
			...countTasksAndDependencies(tasks),
			prdCoverage: checkPrdCoverage(tasks, this.projectRoot),
			tasksPath: this.tasksPath()
		};
	}

	/**
	 * Rewrite dependencies stored as typed ("1.01" as "1.1"), remove
	 * dependencies on missing tasks, self-dependencies and duplicates,
	 * break loops between subtasks and drop links to missing tasks. Loops
	 * through a task are left in `remaining` for the user to break.
	 */
	async fix(options: { tag?: string } = {}): Promise<DependencyFixResult> {
		const { result, tag } = await this.taskService.modifyTasks(
			(tasks, archivedIds) => {
				const before = JSON.stringify(tasks);
				const fixed = fixTaskDependencies(tasks, archivedIds);
				const changed = JSON.stringify(tasks) !== before;
				return {
					tasks: changed ? tasks : null,
					result: { ...fixed, changed, ...countTasksAndDependencies(tasks) }
				};
			},
			options.tag
		);
		return { ...result, tag, tasksPath: this.tasksPath() };
	}

	private tasksPath(): string {
		return path.join(this.projectRoot, TASKGRAPH_TASKS_FILE);
	}
}
