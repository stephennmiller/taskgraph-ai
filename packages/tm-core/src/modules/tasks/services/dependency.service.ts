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
	ERROR_CODES,
	errorWithHint
} from '../../../common/errors/taskgraph-error.js';
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
import { splitIds } from '../utils/task-removal.js';
import { normalizeTaskId } from '../validation/task-id.js';
import type { TaskService } from './task-service.js';

/** `1, 2,1` as `["1", "2"]`; throws for a list with no IDs in it */
function dependencyIds(dependsOn: string): string[] {
	const ids = [...new Set(splitIds(dependsOn).map(normalizeTaskId))];
	if (ids.length === 0) {
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`"${dependsOn}" has no task IDs in it`,
			'Give one ID or a comma-separated list, such as 1,2,3'
		);
	}
	return ids;
}

export class DependencyService {
	constructor(
		private readonly taskService: TaskService,
		private readonly projectRoot: string
	) {}

	/**
	 * Make a task or subtask depend on each task in `dependsOn` (one ID or a
	 * comma-separated list), or with type `related` / `discovered-from` link
	 * them without blocking, in one write. Throws, writing nothing, if any ID
	 * is unknown or archived, the task itself, or would make a loop. Uses the
	 * active tag by default.
	 */
	async add(
		taskId: string,
		dependsOn: string,
		options: { tag?: string; type?: string } = {}
	): Promise<{
		taskId: string;
		results: AddDependencyResult[];
		changed: boolean;
		tag: string;
	}> {
		const { result, tag } = await this.taskService.modifyTasks(
			(tasks, archivedIds) => {
				const results = dependencyIds(dependsOn).map((id) =>
					addDependencyIn(tasks, taskId, id, archivedIds, options.type)
				);
				const changed = results.some((r) => r.changed);
				return { tasks: changed ? tasks : null, result: { results, changed } };
			},
			options.tag
		);
		return { taskId: normalizeTaskId(taskId), ...result, tag };
	}

	/**
	 * Remove each dependency, or related / discovered-from link, in
	 * `dependsOn` (one ID or a comma-separated list) in one write. One the
	 * task never had changes nothing (`removed: false`); an unknown task
	 * throws, writing nothing.
	 */
	async remove(
		taskId: string,
		dependsOn: string,
		options: { tag?: string } = {}
	): Promise<{
		taskId: string;
		results: RemoveDependencyResult[];
		removed: boolean;
		tag: string;
	}> {
		const { result, tag } = await this.taskService.modifyTasks((tasks) => {
			const results = dependencyIds(dependsOn).map((id) =>
				removeDependencyIn(tasks, taskId, id)
			);
			const removed = results.some((r) => r.removed);
			return { tasks: removed ? tasks : null, result: { results, removed } };
		}, options.tag);
		return { taskId: normalizeTaskId(taskId), ...result, tag };
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
