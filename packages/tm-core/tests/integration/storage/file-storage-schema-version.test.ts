/**
 * @fileoverview Integration tests for the tasks.json schemaVersion marker.
 * Uses the real logger configuration: the warning must reach stderr even
 * though the logger is silent by default.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import {
	CURRENT_SCHEMA_VERSION,
	FileStorage,
	getSchemaVersion
} from '../../../src/modules/storage/adapters/file-storage/index.js';

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
	let stderr: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		tasksPath = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		storage = new FileStorage(tempDir);
		stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));
	const writeFile = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	const warnings = () =>
		stderr.mock.calls.map((call: unknown[]) => String(call[0]));

	describe('stamping', () => {
		it('writes schemaVersion on a new standard-format file', async () => {
			await storage.saveTasks([createTask('1')]);

			expect(readFile().metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		});

		it('writes schemaVersion for every tag in a multi-tag file, including the converted master', async () => {
			await storage.saveTasks([createTask('1')], 'master');
			await storage.saveTasks([createTask('1')], 'feature');

			const data = readFile();
			expect(data.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
			expect(data.feature.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		});

		it('stamps the master tag when a standard file without a version is converted', async () => {
			writeFile({ tasks: [createTask('1')], metadata: { version: '1.0.0' } });

			await storage.saveTasks([createTask('2')], 'feature');

			expect(readFile().master.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
		});

		it('stamps tags made by createTag, both from a legacy and a standard file', async () => {
			writeFile({ tasks: [createTask('1')], metadata: { version: '1.0.0' } });
			await storage.createTag('first');
			expect(readFile().first.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
			expect(readFile().master.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);

			await storage.createTag('second');
			expect(readFile().second.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
		});

		it('stamps the tag left behind when master is renamed away from a standard file', async () => {
			writeFile({ tasks: [createTask('1')], metadata: { version: '1.0.0' } });

			await storage.renameTag('master', 'main');

			expect(readFile().main.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
		});

		it('loads a legacy file without schemaVersion unchanged and stamps it on next save', async () => {
			writeFile({
				master: { tasks: [createTask('1')], metadata: { version: '1.0.0' } }
			});

			const tasks = await storage.loadTasks();
			const metadata = await storage.loadMetadata();

			expect(tasks).toHaveLength(1);
			expect(metadata?.schemaVersion).toBeUndefined();
			expect(warnings()).toEqual([]);

			await storage.saveTasks(tasks);
			expect(readFile().master.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
		});

		it('does not invent a version for a tag with no metadata on the read path', async () => {
			writeFile({ master: { tasks: [createTask('1')] } });

			const metadata = await storage.loadMetadata();

			expect(metadata?.schemaVersion).toBeUndefined();
			expect(getSchemaVersion(metadata)).toBe(1);
		});
	});

	describe('newer or malformed versions', () => {
		const newerFile = (version: unknown) => ({
			master: {
				tasks: [createTask('1')],
				metadata: { version: '1.0.0', schemaVersion: version }
			}
		});

		it('warns on stderr but still loads a file with a newer schemaVersion', async () => {
			writeFile(newerFile(999));

			const tasks = await storage.loadTasks();

			expect(tasks).toHaveLength(1);
			expect(warnings()).toHaveLength(1);
			expect(warnings()[0]).toContain('999');
		});

		it('warns once per file and tag, even across storage instances', async () => {
			writeFile(newerFile(999));

			await storage.loadTasks();
			await storage.loadTasks();
			await new FileStorage(tempDir).loadTasks();

			expect(warnings()).toHaveLength(1);
		});

		it('warns about a malformed schemaVersion and treats it as v1', async () => {
			writeFile(newerFile('2'));

			await storage.loadTasks();

			expect(warnings()).toHaveLength(1);
			expect(warnings()[0]).toContain('unrecognized');
			expect(getSchemaVersion({ schemaVersion: '2' as never })).toBe(1);
		});

		it.each([0, -1, 1.5])('rejects %s as a version', (value) => {
			expect(getSchemaVersion({ schemaVersion: value })).toBe(1);
		});

		it('keeps the newer version when saving a legacy-format tag', async () => {
			writeFile(newerFile(999));

			await storage.saveTasks([createTask('1'), createTask('2')]);

			expect(readFile().master.metadata.schemaVersion).toBe(999);
		});

		it('keeps the newer version when saving a standard-format file', async () => {
			writeFile({
				tasks: [createTask('1')],
				metadata: { version: '1.0.0', schemaVersion: 999 }
			});

			await storage.saveTasks([createTask('1'), createTask('2')]);

			expect(readFile().metadata.schemaVersion).toBe(999);
		});

		it('keeps the newer version on master when another tag is added', async () => {
			writeFile({
				tasks: [createTask('1')],
				metadata: { version: '1.0.0', schemaVersion: 999 }
			});

			await storage.saveTasks([createTask('2')], 'feature');

			expect(readFile().master.metadata.schemaVersion).toBe(999);
			expect(readFile().feature.metadata.schemaVersion).toBe(
				CURRENT_SCHEMA_VERSION
			);
		});
	});
});
