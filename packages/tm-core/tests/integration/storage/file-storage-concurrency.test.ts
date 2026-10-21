/**
 * @fileoverview Integration tests for FileStorage read-modify-write safety
 *
 * Mutations must read the current file inside the lock. Reading before the lock
 * and writing the stale copy back reverts changes made by other writers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import type { Task } from '../../../src/common/types/index.js';

function createTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		title: `Task ${id}`,
		description: `Description for task ${id}`,
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...overrides
	};
}

describe('FileStorage concurrent writes - Integration Tests', () => {
	let tempDir: string;
	let storage: FileStorage;
	let tasksFile: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		tasksFile = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		storage = new FileStorage(tempDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('keeps every status change when several run at once', async () => {
		const ids = ['1', '2', '3', '4', '5'];
		await storage.saveTasks(ids.map((id) => createTask(id)));

		await Promise.all(ids.map((id) => storage.updateTaskStatus(id, 'done')));

		const tasks = await storage.loadTasks();
		expect(tasks.map((t) => t.status)).toEqual(ids.map(() => 'done'));
	});

	it('does not revert an appended task when a status change runs at once', async () => {
		await storage.saveTasks([createTask('1')]);

		await Promise.all([
			storage.updateTaskStatus('1', 'done'),
			storage.appendTasks([createTask('2')])
		]);

		const tasks = await storage.loadTasks();
		expect(tasks.map((t) => String(t.id))).toEqual(['1', '2']);
		expect(tasks[0].status).toBe('done');
	});

	it('does not bring back a deleted task when an update runs at once', async () => {
		await storage.saveTasks([createTask('1'), createTask('2')]);

		await Promise.all([
			storage.deleteTask('2'),
			storage.updateTask('1', { title: 'Renamed' })
		]);

		const tasks = await storage.loadTasks();
		expect(tasks.map((t) => String(t.id))).toEqual(['1']);
		expect(tasks[0].title).toBe('Renamed');
	});

	it('never writes the text "undefined" as a subtask parentId', async () => {
		await storage.saveTasks([
			createTask('1', {
				subtasks: [
					{
						id: 1,
						title: 'Sub',
						description: '',
						status: 'pending',
						dependencies: [],
						details: '',
						testStrategy: ''
					} as any
				]
			})
		]);

		await storage.updateTaskStatus('1', 'in-progress');

		const raw = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
		const subtask = (raw.master?.tasks ?? raw.tasks)[0].subtasks[0];
		expect(subtask.parentId).toBe('1');
	});
});
