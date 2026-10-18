/**
 * @fileoverview Testing utilities for @tm/core
 *
 * This module provides test fixtures and utilities for testing applications
 * that use @tm/core. Import from '@tm/core/testing' or '@tm/core'.
 *
 * @example
 * ```ts
 * import { createTask, createTasksFile, TaskScenarios } from '@tm/core/testing';
 *
 * const task = createTask({ id: 1, title: 'Test Task' });
 * const tasksFile = TaskScenarios.linearDependencyChain();
 * ```
 */

export {
	createTask,
	createSubtask,
	createTasksFile,
	TaskScenarios,
	MetadataFixtures,
	type TasksFile
} from './task-fixtures.js';

export { createMockLogger } from './test-mocks.js';
