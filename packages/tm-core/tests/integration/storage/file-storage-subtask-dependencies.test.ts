/**
 * @fileoverview A subtask's stored dependencies resolve by the one shared
 * rule when it is loaded on its own: a number is a sibling, a dotted string
 * a subtask, any other string a task.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Subtask, Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
	id,
	title: `Task ${id}`,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	...overrides
});

describe('FileStorage subtask dependencies - Integration Tests', () => {
	let tempDir: string;
	let storage: FileStorage;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		storage = new FileStorage(tempDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('resolves numbers to siblings, dotted strings as given and other strings to tasks', async () => {
		const dependencies = [1, '3', '2.1', 150];
		const { subtasks: _none, ...base } = task('2');
		const child: Subtask = {
			...base,
			id: 2,
			parentId: '2',
			dependencies
		};
		await storage.saveTasks([task('2', { subtasks: [child] })]);

		const loaded = await storage.loadTask('2.2');

		expect(loaded?.dependencies).toEqual(['2.1', '3', '2.1', '150']);
	});
});
