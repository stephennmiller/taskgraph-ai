/**
 * @fileoverview Dependency provenance (metadata.dependencySources) must
 * survive FileStorage operations, and files without it must load as explicit.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import {
	DEPENDENCY_SOURCES_KEY,
	getDependencySource
} from '../../../src/modules/dependencies/dependency-provenance.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { seedTasks } from '../seed-tasks.js';

function createTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
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
	};
}

describe('FileStorage dependency provenance - Integration Tests', () => {
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

	const inferredTask = () =>
		createTask('2', {
			dependencies: ['1'],
			metadata: { [DEPENDENCY_SOURCES_KEY]: { '1': 'inferred' } }
		});

	it('survives a save and load round-trip', async () => {
		await seedTasks(storage, [createTask('1'), inferredTask()]);

		const loaded = (await storage.loadTasks()).find((t) => t.id === '2');

		expect(getDependencySource(loaded as Task, '1')).toBe('inferred');
	});

	it('survives modifyTask calls that do not touch metadata', async () => {
		await seedTasks(storage, [createTask('1'), inferredTask()]);

		await storage.modifyTask('2', () => ({
			title: 'Renamed',
			priority: 'high'
		}));

		const loaded = (await storage.loadTasks()).find((t) => t.id === '2');
		expect(loaded?.title).toBe('Renamed');
		expect(getDependencySource(loaded as Task, '1')).toBe('inferred');
	});

	it('survives appendTasks and status updates', async () => {
		await seedTasks(storage, [createTask('1'), inferredTask()]);

		await storage.appendTasks([createTask('3')]);
		await storage.updateTaskStatus('2', 'in-progress');

		const loaded = (await storage.loadTasks()).find((t) => t.id === '2');
		expect(getDependencySource(loaded as Task, '1')).toBe('inferred');
	});

	it('reads the mark of a numeric sibling dependency through loadTask', async () => {
		await seedTasks(storage, [
			createTask('2', {
				subtasks: [
					{
						id: '1',
						parentId: '2',
						title: 'S1',
						description: '',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						details: '',
						testStrategy: ''
					},
					{
						id: '2',
						parentId: '2',
						title: 'S2',
						description: '',
						status: 'pending',
						priority: 'medium',
						dependencies: [1],
						details: '',
						testStrategy: '',
						metadata: { [DEPENDENCY_SOURCES_KEY]: { '2.1': 'inferred' } }
					}
				]
			})
		]);

		// loadTask resolves the numeric sibling to its dotted form, the mark's key
		const subtask = (await storage.loadTask('2.2')) as Task;

		expect(subtask.dependencies).toEqual(['2.1']);
		expect(getDependencySource(subtask, '2.1', 2)).toBe('inferred');
	});

	it('characterization: loads a legacy file without provenance as all explicit', async () => {
		fs.writeFileSync(
			path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [createTask('1'), createTask('2', { dependencies: ['1'] })]
				}
			})
		);

		const loaded = (await storage.loadTasks()).find((t) => t.id === '2');

		expect(getDependencySource(loaded as Task, '1')).toBe('explicit');
	});
});
