/**
 * @fileoverview Task entity with business rules and domain logic
 */

import {
	ERROR_CODES,
	TaskGraphError
} from '../../../common/errors/taskgraph-error.js';
import type {
	Subtask,
	Task,
	TaskPriority,
	TaskStatus
} from '../../../common/types/index.js';
import { promotedSubtaskDescription } from '../utils/promoted-subtask.js';
import { normalizeTaskIds } from '../utils/task-ids.js';

/**
 * Task entity representing a task with business logic
 * Encapsulates validation and state management rules
 */
export class TaskEntity implements Task {
	readonly id: string;
	title: string;
	description: string;
	status: TaskStatus;
	priority: TaskPriority;
	dependencies: string[];
	details: string;
	testStrategy: string;
	subtasks: Subtask[];

	// Optional properties
	createdAt?: string;
	updatedAt?: string;
	effort?: number;
	actualEffort?: number;
	tags?: string[];
	assignee?: string;
	complexity?: Task['complexity'];
	recommendedSubtasks?: number;
	expansionPrompt?: string;
	complexityReasoning?: string;
	metadata?: Record<string, unknown>;

	/** The task as loaded, so toJSON keeps the fields this class doesn't model (acceptanceCriteria, ...) */
	readonly #source: Partial<Task>;

	constructor(data: Task | (Omit<Task, 'id'> & { id: number | string })) {
		this.validate(data);
		this.#source = data as Partial<Task>;

		// IDs as strings: the task's, its dependencies', and each subtask's
		// (with parentId, which older files leave out)
		const ids = normalizeTaskIds(data as Task);
		this.id = ids.id;
		this.title = data.title;
		// Files from earlier versions can hold a task with no description
		// (`remove-subtask --convert` copied an empty one). It takes its title,
		// so one such task doesn't stop the whole tag from loading
		this.description = promotedSubtaskDescription(data);
		this.status = data.status;
		// Hand-edited or older files can leave priority out; read it as medium
		// instead of failing every reader of the tag
		this.priority = data.priority ?? 'medium';
		this.dependencies = ids.dependencies;
		this.details = data.details;
		this.testStrategy = data.testStrategy;
		this.subtasks = ids.subtasks;

		// Optional properties
		this.createdAt = data.createdAt;
		this.updatedAt = data.updatedAt;
		this.effort = data.effort;
		this.actualEffort = data.actualEffort;
		this.tags = data.tags;
		this.assignee = data.assignee;
		this.complexity = data.complexity;
		this.recommendedSubtasks = data.recommendedSubtasks;
		this.expansionPrompt = data.expansionPrompt;
		this.complexityReasoning = data.complexityReasoning;
		this.metadata = data.metadata;
	}

	/**
	 * Validate task data
	 */
	private validate(
		data: Partial<Task> | Partial<Omit<Task, 'id'> & { id: number | string }>
	): void {
		if (
			data.id === undefined ||
			data.id === null ||
			(typeof data.id !== 'string' && typeof data.id !== 'number')
		) {
			throw new TaskGraphError(
				'Task ID is required and must be a string or number',
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		if (!data.title || data.title.trim().length === 0) {
			throw new TaskGraphError(
				'Task title is required',
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		if (!this.isValidStatus(data.status)) {
			throw new TaskGraphError(
				`Invalid task status: ${data.status}`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		if (data.priority != null && !this.isValidPriority(data.priority)) {
			throw new TaskGraphError(
				`Invalid task priority: ${data.priority}`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}
	}

	/**
	 * Check if status is valid
	 */
	private isValidStatus(status: any): status is TaskStatus {
		return [
			'pending',
			'in-progress',
			'done',
			'deferred',
			'cancelled',
			'blocked',
			'review'
		].includes(status);
	}

	/**
	 * Check if priority is valid
	 */
	private isValidPriority(priority: any): priority is TaskPriority {
		return ['low', 'medium', 'high', 'critical'].includes(priority);
	}

	/**
	 * Check if task can be marked as complete
	 */
	canComplete(): boolean {
		// Cannot complete if status is already done or cancelled
		if (this.status === 'done' || this.status === 'cancelled') {
			return false;
		}

		// Cannot complete if blocked
		if (this.status === 'blocked') {
			return false;
		}

		// Check if all subtasks are complete
		const allSubtasksComplete = this.subtasks.every(
			(subtask) => subtask.status === 'done' || subtask.status === 'cancelled'
		);

		return allSubtasksComplete;
	}

	/**
	 * Mark task as complete
	 */
	markAsComplete(): void {
		if (!this.canComplete()) {
			throw new TaskGraphError(
				'Task cannot be marked as complete',
				ERROR_CODES.TASK_STATUS_ERROR,
				{
					taskId: this.id,
					currentStatus: this.status,
					hasIncompleteSubtasks: this.subtasks.some(
						(s) => s.status !== 'done' && s.status !== 'cancelled'
					)
				}
			);
		}

		this.status = 'done';
		this.updatedAt = new Date().toISOString();
	}

	/**
	 * Check if task has dependencies
	 */
	hasDependencies(): boolean {
		return this.dependencies.length > 0;
	}

	/**
	 * Check if task has subtasks
	 */
	hasSubtasks(): boolean {
		return this.subtasks.length > 0;
	}

	/**
	 * Add a subtask
	 */
	addSubtask(subtask: Omit<Subtask, 'id' | 'parentId'>): void {
		const nextId = this.subtasks.length + 1;
		this.subtasks.push({
			...subtask,
			id: String(nextId),
			parentId: this.id
		});
		this.updatedAt = new Date().toISOString();
	}

	/**
	 * Update task status
	 */
	updateStatus(newStatus: TaskStatus): void {
		if (!this.isValidStatus(newStatus)) {
			throw new TaskGraphError(
				`Invalid status: ${newStatus}`,
				ERROR_CODES.VALIDATION_ERROR
			);
		}

		// Business rule: Cannot move from done to pending
		if (this.status === 'done' && newStatus === 'pending') {
			throw new TaskGraphError(
				'Cannot move completed task back to pending',
				ERROR_CODES.TASK_STATUS_ERROR
			);
		}

		this.status = newStatus;
		this.updatedAt = new Date().toISOString();
	}

	/**
	 * Convert entity to plain object
	 */
	toJSON(): Task {
		return {
			...this.#source,
			id: this.id,
			title: this.title,
			description: this.description,
			status: this.status,
			priority: this.priority,
			dependencies: this.dependencies,
			details: this.details,
			testStrategy: this.testStrategy,
			subtasks: this.subtasks,
			createdAt: this.createdAt,
			updatedAt: this.updatedAt,
			effort: this.effort,
			actualEffort: this.actualEffort,
			tags: this.tags,
			assignee: this.assignee,
			complexity: this.complexity,
			recommendedSubtasks: this.recommendedSubtasks,
			expansionPrompt: this.expansionPrompt,
			complexityReasoning: this.complexityReasoning,
			metadata: this.metadata
		};
	}

	/**
	 * Create TaskEntity from plain object
	 */
	static fromObject(data: Task): TaskEntity {
		return new TaskEntity(data);
	}

	/**
	 * Create multiple TaskEntities from array
	 */
	static fromArray(data: Task[]): TaskEntity[] {
		return data.map((task) => new TaskEntity(task));
	}
}
