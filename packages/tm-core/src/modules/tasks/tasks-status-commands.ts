/**
 * @fileoverview Status changes of the tasks domain and the gates a move to
 * done passes: the checklist (acceptance criteria and Definition of Done)
 * and, in a loop run, `loop.smokeCommand`. TasksDomain exposes each one as
 * `tmCore.tasks.<name>`.
 */

import type { TaskStatus } from '../../common/types/index.js';
import type { UpdateStatusOptions } from '../../common/interfaces/storage.interface.js';
import type { ConfigManager } from '../config/managers/config-manager.js';
import type { TaskService } from './services/task-service.js';
import { checkDoneGate } from './utils/acceptance-criteria.js';
import { newlyReadyTasks } from './utils/next-task.js';
import { runSmokeCheck, smokeCommandFor } from './utils/smoke-gate.js';
import { normalizeTaskId } from './validation/task-id.js';

export class TaskStatusCommands {
	constructor(
		private readonly taskService: TaskService,
		private readonly configManager: ConfigManager
	) {}

	/**
	 * Update task status.
	 *
	 * Moving a task to done is refused while its checklist (its acceptance
	 * criteria, plus the project's Definition of Done for a top-level task)
	 * has unchecked items: the error has code CRITERIA_UNCHECKED, and
	 * `getUncheckedCriteria(error)` lists them. In a loop run with
	 * `loop.smokeCommand` set, done is also refused while that command fails.
	 * `force` skips both checks. A parent whose last subtask finishes stays in
	 * progress until its own checklist is clear, even with `force`.
	 */
	async updateStatus(
		taskId: string,
		status: TaskStatus,
		tag?: string,
		options: { force?: boolean } = {}
	) {
		await this.smokeGate([taskId], status, options.force);
		return this.taskService.updateTaskStatus(
			normalizeTaskId(taskId),
			status,
			tag,
			this.statusWriteOptions(options.force)
		);
	}

	/**
	 * `updateStatus` for several ids in one write: a missing id or a refused
	 * done leaves every id unchanged. `ready`: what a done unblocked, in next order
	 */
	async updateStatuses(
		taskIds: string[],
		status: TaskStatus,
		tag?: string,
		options: { force?: boolean } = {}
	) {
		await this.smokeGate(taskIds, status, options.force);
		const view = () => this.taskService.getDependencyView(tag);
		const before = status === 'done' ? await view() : undefined;
		const updated = await this.taskService.updateTaskStatuses(
			taskIds.map(normalizeTaskId),
			status,
			tag,
			this.statusWriteOptions(options.force)
		);
		const ready = before ? newlyReadyTasks(before, await view()) : [];
		return { updated, ready };
	}

	/**
	 * In a loop run, moving a task to done first runs `loop.smokeCommand`
	 * (#949); `force` skips it like the checklist gate
	 */
	private async smokeGate(
		taskIds: string[],
		status: TaskStatus,
		force?: boolean
	): Promise<void> {
		if (status !== 'done' || force) return;
		const loop = (this.configManager.getConfig() as { loop?: unknown }).loop;
		const command = smokeCommandFor(loop);
		if (command)
			await runSmokeCheck(
				command,
				this.configManager.getProjectRoot(),
				taskIds
			);
	}

	/** The done gate shared by updateStatus and updateStatuses */
	private statusWriteOptions(force?: boolean): UpdateStatusOptions {
		const definitionOfDone = this.configManager.getDefinitionOfDone();
		return {
			guardDone: (task, id, auto) =>
				force && !auto
					? undefined
					: checkDoneGate(task, id, definitionOfDone, id.includes('.'))
		};
	}
}
