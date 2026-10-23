/**
 * @fileoverview In-memory status and field updates for one task or subtask.
 * FileStorage runs these inside its locked read-modify-write; a returned
 * `tasks: null` means nothing changed.
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../../common/errors/taskgraph-error.js';
import type {
	TaskFieldUpdates,
	UpdateStatusOptions,
	UpdateStatusResult
} from '../../../../common/interfaces/storage.interface.js';
import type {
	Subtask,
	Task,
	TaskStatus
} from '../../../../common/types/index.js';
import { releaseClaimIfPending } from '../../../tasks/utils/claim.js';

type Outcome<R> = { tasks: Task[] | null; result: R };

/** 'completed' counts as done everywhere else, so it is gated too */
const isDoneStatus = (status: TaskStatus) =>
	status === 'done' || status === 'completed';

/**
 * A missing task or subtask. Coded so callers can tell it apart from storage
 * failures; `userMessage` drops detail the ID already carries.
 */
export function taskNotFound(
	message: string,
	userMessage = message
): TaskGraphError {
	return new TaskGraphError(message, ERROR_CODES.TASK_NOT_FOUND, {
		userMessage
	});
}

/**
 * Set a task or subtask's status, adjusting a subtask's parent to match
 */
export function setTaskStatusIn(
	tasks: Task[],
	taskId: string,
	newStatus: TaskStatus,
	options: UpdateStatusOptions
): Outcome<UpdateStatusResult> {
	// Check if this is a subtask (contains a dot)
	if (taskId.includes('.')) {
		return setSubtaskStatusIn(tasks, taskId, newStatus, options);
	}

	// Handle regular task update
	const taskIndex = tasks.findIndex((t) => String(t.id) === String(taskId));

	if (taskIndex === -1) {
		throw taskNotFound(`Task ${taskId} not found`);
	}

	const oldStatus = tasks[taskIndex].status;
	const result: UpdateStatusResult = {
		success: true,
		oldStatus,
		newStatus,
		taskId: String(taskId)
	};
	if (oldStatus === newStatus) {
		return { tasks: null, result };
	}
	if (isDoneStatus(newStatus)) {
		const refusal = options.guardDone?.(
			tasks[taskIndex],
			String(taskId),
			false
		);
		if (refusal) throw refusal;
	}

	const updated = [...tasks];
	updated[taskIndex] = releaseClaimIfPending(
		{
			...tasks[taskIndex],
			status: newStatus,
			updatedAt: new Date().toISOString()
		},
		newStatus
	);
	return { tasks: updated, result };
}

/**
 * Update subtask status within file storage - handles parent status auto-adjustment
 */
function setSubtaskStatusIn(
	tasks: Task[],
	subtaskId: string,
	newStatus: TaskStatus,
	options: UpdateStatusOptions
): { tasks: Task[] | null; result: UpdateStatusResult } {
	const parts = subtaskId.split('.');
	if (parts.length !== 2) {
		throw new Error(
			`Invalid subtask ID format: ${subtaskId}. Expected format: parentId.subtaskId`
		);
	}

	const [parentId, subIdRaw] = parts;
	const subId = subIdRaw.trim();
	if (!/^\d+$/.test(subId)) {
		throw new Error(
			`Invalid subtask ID: ${subId}. Subtask ID must be a positive integer.`
		);
	}
	const subtaskNumericId = Number(subId);

	const parentTaskIndex = tasks.findIndex(
		(t) => String(t.id) === String(parentId)
	);

	if (parentTaskIndex === -1) {
		throw taskNotFound(
			`Parent task ${parentId} not found`,
			`Task ${parentId} not found`
		);
	}

	const parentTask = {
		...tasks[parentTaskIndex],
		subtasks: [...(tasks[parentTaskIndex].subtasks ?? [])]
	};

	// Find the subtask within the parent task
	const subtaskIndex = parentTask.subtasks.findIndex(
		(st) => st.id === subtaskNumericId || String(st.id) === subId
	);

	if (subtaskIndex === -1) {
		throw taskNotFound(
			`Subtask ${subtaskId} not found in parent task ${parentId}`,
			`Subtask ${subtaskId} not found`
		);
	}

	const oldStatus = parentTask.subtasks[subtaskIndex].status || 'pending';
	const result: UpdateStatusResult = {
		success: true,
		oldStatus,
		newStatus,
		taskId: subtaskId
	};
	if (oldStatus === newStatus) {
		return { tasks: null, result };
	}
	if (isDoneStatus(newStatus)) {
		const refusal = options.guardDone?.(
			parentTask.subtasks[subtaskIndex],
			subtaskId,
			false
		);
		if (refusal) throw refusal;
	}

	const now = new Date().toISOString();

	// Update the subtask status
	parentTask.subtasks[subtaskIndex] = releaseClaimIfPending(
		{
			...parentTask.subtasks[subtaskIndex],
			status: newStatus,
			updatedAt: now
		},
		newStatus
	);

	// Auto-adjust parent status based on subtask statuses
	const subs = parentTask.subtasks;
	let parentNewStatus = parentTask.status;
	if (subs.length > 0) {
		const norm = (s: any) => s.status || 'pending';
		const isDoneLike = (s: any) => {
			const st = norm(s);
			return st === 'done' || st === 'completed';
		};
		const allDone = subs.every(isDoneLike);
		const anyInProgress = subs.some((s) => norm(s) === 'in-progress');
		const anyDone = subs.some(isDoneLike);
		const allPending = subs.every((s) => norm(s) === 'pending');

		if (allDone) {
			// A parent with unchecked criteria waits in progress for them
			const refusal =
				parentTask.status !== 'done'
					? options.guardDone?.(parentTask, String(parentTask.id), true)
					: undefined;
			parentNewStatus = refusal ? 'in-progress' : 'done';
		} else if (anyInProgress || anyDone) parentNewStatus = 'in-progress';
		else if (allPending) parentNewStatus = 'pending';
	}

	// Always bump updatedAt; update status only if changed
	const updated = [...tasks];
	updated[parentTaskIndex] = {
		...parentTask,
		...(parentNewStatus !== parentTask.status
			? { status: parentNewStatus }
			: {}),
		updatedAt: now
	};

	return { tasks: updated, result };
}

/**
 * Merge the fields `change` returns into one task or subtask
 */
export function modifyTaskIn(
	tasks: Task[],
	taskId: string,
	change: (task: Task | Subtask, isSubtask: boolean) => TaskFieldUpdates
): Outcome<Task | Subtask> {
	const parts = taskId.split('.');
	if (parts.length > 2) {
		throw taskNotFound(
			`Task ${taskId} not found: sub-subtask IDs aren't supported`,
			`Task ${taskId} not found`
		);
	}
	const [parentId, subId] = parts;
	const taskIndex = tasks.findIndex((t) => String(t.id) === String(parentId));
	if (taskIndex === -1) {
		throw taskNotFound(`Task ${parentId} not found`);
	}
	const now = new Date().toISOString();
	const updated = [...tasks];

	if (subId === undefined) {
		const saved: Task = {
			...tasks[taskIndex],
			...change(tasks[taskIndex], false),
			updatedAt: now
		};
		updated[taskIndex] = saved;
		return { tasks: updated, result: saved };
	}

	const subtasks = [...(tasks[taskIndex].subtasks ?? [])];
	const subIndex = subtasks.findIndex((st) => String(st.id) === subId);
	if (subIndex === -1) {
		throw taskNotFound(
			`Subtask ${taskId} not found in parent task ${parentId}`,
			`Subtask ${taskId} not found`
		);
	}
	const saved: Subtask = {
		...subtasks[subIndex],
		...change(subtasks[subIndex], true),
		updatedAt: now
	};
	subtasks[subIndex] = saved;
	updated[taskIndex] = { ...tasks[taskIndex], subtasks, updatedAt: now };
	return { tasks: updated, result: saved };
}
