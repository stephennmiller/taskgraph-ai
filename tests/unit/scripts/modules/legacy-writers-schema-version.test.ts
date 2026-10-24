/**
 * The legacy writers of tasks.json stamp each tag's metadata.schemaVersion,
 * as @tm/core's FileStorage does (#218)
 */
// Load ui.js first: Vitest's module runner mishandles the @tm/cli <-> ui.js
// import cycle (`export * as ui`) when @tm/cli is the entry point.
import '../../../../scripts/modules/ui.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { CURRENT_SCHEMA_VERSION } from '@tm/core';
import { createInitialTasksFile } from '../../../../scripts/modules/init-project-files.js';
import { readJSON, writeJSON } from '../../../../scripts/modules/utils.js';
import { updateTagTasks } from '../../../../scripts/modules/utils/update-tag-tasks.js';

describe('legacy tasks.json writers stamp schemaVersion', () => {
	let dir: string;
	let tasksPath: string;

	const read = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const writeFile = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-schema-version-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('writeJSON stamps every tag of a whole file it is given', () => {
		writeJSON(tasksPath, {
			master: { tasks: [], metadata: { created: '2020-01-01' } },
			feature: { tasks: [] }
		});

		const saved = read();
		expect(saved.master.metadata).toEqual({
			created: '2020-01-01',
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
		expect(saved.feature.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('writeJSON stamps a tag saved from data readJSON returned', () => {
		writeFile({ master: { tasks: [], metadata: { created: '2020-01-01' } } });

		const data = readJSON(tasksPath, dir, 'master');
		data.tasks.push({ id: 1, title: 'New', status: 'pending' });
		writeJSON(tasksPath, data, dir, 'master');

		const saved = read();
		expect(saved.master.tasks).toHaveLength(1);
		expect(saved.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('writeJSON keeps a newer version a newer build recorded', () => {
		const newer = CURRENT_SCHEMA_VERSION + 1;
		writeJSON(tasksPath, {
			master: { tasks: [], metadata: { schemaVersion: newer } }
		});

		expect(read().master.metadata.schemaVersion).toBe(newer);
	});

	it('writeJSON stamps a tag named __proto__ and keeps it as data', () => {
		const raw = JSON.parse(
			'{"master":{"tasks":[]},"__proto__":{"tasks":[],"metadata":{"created":"c"}}}'
		);

		writeJSON(tasksPath, raw);

		const saved = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		expect(Object.hasOwn(saved, '__proto__')).toBe(true);
		expect(saved.__proto__.metadata).toEqual({
			created: 'c',
			schemaVersion: CURRENT_SCHEMA_VERSION
		});
		expect(saved.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('modifyJSON (add-task and other updateTagTasks callers) stamps the tag', async () => {
		writeFile({ master: { tasks: [], metadata: {} } });

		await updateTagTasks(tasksPath, 'master', (tag) => {
			tag.tasks.push({ id: 1, title: 'T' });
		});

		expect(read().master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});

	it('init stamps the empty tasks file it creates', () => {
		createInitialTasksFile(dir);

		const saved = read();
		expect(saved.master.tasks).toEqual([]);
		expect(saved.master.metadata.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
	});
});
