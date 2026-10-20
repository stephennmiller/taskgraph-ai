/**
 * @fileoverview Integration tests for the tasks.json schemaVersion marker
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import {
	CURRENT_SCHEMA_VERSION,
	FileStorage
} from '../../../src/modules/storage/adapters/file-storage/index.js';

// The real logger is silent by default, so capture warnings through a spy
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../../src/common/logger/index.js', () => ({
	getLogger: () => ({ warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() })
}));

function createTask(id: string): Task {
	return {
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: []
	};
}

describe('FileStorage schemaVersion - Integration Tests', () => {
	let tempDir: string;
	let tasksPath: string;
	let storage: FileStorage;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		tasksPath = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		storage = new FileStorage(tempDir);
	});

	afterEach(() => {
		warn.mockClear();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));

	it('writes schemaVersion on a new standard-format file', async () => {
		await storage.saveTasks([createTask('1')]);

		expect(readFile().metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('writes schemaVersion for every tag in a multi-tag file', async () => {
		await storage.saveTasks([createTask('1')], 'master');
		await storage.saveTasks([createTask('1')], 'feature');

		const data = readFile();
		expect(data.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(data.feature.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('loads a legacy file without schemaVersion unchanged and stamps it on next save', async () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: [createTask('1')], metadata: { version: '1.0.0' } }
			})
		);

		const tasks = await storage.loadTasks();
		const metadata = await storage.loadMetadata();

		expect(tasks).toHaveLength(1);
		expect(metadata?.schemaVersion).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();

		await storage.saveTasks(tasks);
		expect(readFile().master.metadata.schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION
		);
	});

	it('warns but still loads a file with a newer schemaVersion', async () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [createTask('1')],
					metadata: { version: '1.0.0', schemaVersion: 999 }
				}
			})
		);

		const tasks = await storage.loadTasks();

		expect(tasks).toHaveLength(1);
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain('999');
	});
});
