/**
 * @fileoverview Tag names that are also Object.prototype members
 * (`constructor`, `toString`, `__proto__`) must act like any other name in a
 * multi-tag tasks.json (#379)
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/index.js';
import { TagService } from '../../../src/modules/tasks/services/tag.service.js';

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

describe('FileStorage tag names shared with Object.prototype', () => {
	let tempDir: string;
	let tasksPath: string;
	let storage: FileStorage;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		tasksPath = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		// A multi-tag (legacy-format) file
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: [createTask('1')], metadata: {} },
				feature: { tasks: [], metadata: {} }
			})
		);
		storage = new FileStorage(tempDir);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));

	it('creates a tag named constructor', async () => {
		await storage.createTag('constructor');

		expect(Object.keys(readFile())).toContain('constructor');
		expect(await storage.getAllTags()).toContain('constructor');
	});

	it('saves to, renames and deletes a tag named constructor', async () => {
		await storage.createTag('constructor');
		await storage.saveTasks([createTask('7')], 'constructor');

		expect((await storage.loadTasks('constructor')).map((t) => t.id)).toEqual([
			'7'
		]);

		await storage.renameTag('constructor', 'valueOf');
		expect(Object.keys(readFile())).toEqual(['master', 'feature', 'valueOf']);

		await storage.deleteTag('valueOf');
		expect(Object.keys(readFile())).toEqual(['master', 'feature']);
	});

	it('copies nothing from a missing tag named toString', async () => {
		await storage.createTag('copy', { copyFrom: 'toString' });

		expect(readFile().copy.tasks).toEqual([]);
	});

	it('reads no tasks or metadata for a missing tag named toString', async () => {
		expect(await storage.loadTasks('toString')).toEqual([]);
		expect(await storage.loadMetadata('toString')).toBeNull();
	});

	it('reports a missing tag named toString as not found on delete and rename', async () => {
		await expect(storage.deleteTag('toString')).rejects.toThrow(
			'Tag toString not found'
		);
		await expect(storage.renameTag('toString', 'other')).rejects.toThrow(
			'Tag toString not found'
		);
	});

	it('keeps a __proto__ tag as data when saving to it', async () => {
		await storage.saveTasks([createTask('3')], '__proto__');

		const raw = fs.readFileSync(tasksPath, 'utf-8');
		expect(raw).toContain('"__proto__"');
		expect(Object.hasOwn(JSON.parse(raw), '__proto__')).toBe(true);
		expect((await storage.loadTasks('__proto__')).map((t) => t.id)).toEqual([
			'3'
		]);
		// Nothing leaked onto plain objects
		expect(({} as { tasks?: unknown }).tasks).toBeUndefined();
	});

	it('refuses to create a tag named __proto__', async () => {
		const tags = new TagService(storage);

		await expect(tags.createTag('__proto__')).rejects.toThrow(
			'"__proto__" is a reserved tag name'
		);
		await expect(tags.renameTag('feature', '__proto__')).rejects.toThrow(
			'"__proto__" is a reserved tag name'
		);
		await expect(tags.copyTag('feature', '__proto__')).rejects.toThrow(
			'"__proto__" is a reserved tag name'
		);
		expect(Object.keys(readFile())).toEqual(['master', 'feature']);
	});

	it('renames and deletes a __proto__ tag that is already in the file', async () => {
		// JSON.parse keeps a "__proto__" key as data, as a hand edit would leave it
		fs.writeFileSync(
			tasksPath,
			'{"master":{"tasks":[],"metadata":{}},"__proto__":{"tasks":[],"metadata":{}}}'
		);
		const tags = new TagService(storage);

		await tags.renameTag('__proto__', 'renamed');
		expect(Object.keys(readFile())).toEqual(['master', 'renamed']);

		fs.writeFileSync(
			tasksPath,
			'{"master":{"tasks":[],"metadata":{}},"__proto__":{"tasks":[],"metadata":{}}}'
		);
		await tags.deleteTag('__proto__');
		expect(Object.keys(readFile())).toEqual(['master']);
	});
});
