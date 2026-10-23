/**
 * parse-prd must not treat an unreadable tasks.json as empty: that skips the
 * overwrite check and the save then replaces every tag in the file.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
	loadExistingTasks,
	saveTasksToFile
} from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const logger = { report: () => {} };
const corrupt = '{"master": {"tasks": [{"id": 1},]}, "other": {"tasks": []}}';

describe('parse-prd with an unreadable tasks.json', () => {
	let dir;
	let tasksPath;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parse-prd-'));
		tasksPath = path.join(dir, 'tasks.json');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('loadExistingTasks throws instead of returning no tasks', () => {
		fs.writeFileSync(tasksPath, corrupt);

		expect(() => loadExistingTasks(tasksPath, 'master')).toThrow(
			/not valid JSON/
		);
	});

	test('saveTasksToFile throws and leaves the file as it was', () => {
		fs.writeFileSync(tasksPath, corrupt);

		expect(() =>
			saveTasksToFile(tasksPath, [{ id: 1, title: 'T' }], 'master', logger)
		).toThrow(/not valid JSON/);
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(corrupt);
	});

	test('an empty file still counts as no tasks', () => {
		fs.writeFileSync(tasksPath, '  \n');

		expect(loadExistingTasks(tasksPath, 'master')).toEqual({
			existingTasks: [],
			nextId: 1,
			firstFreeId: 1,
			tagMetadata: {}
		});
	});
});
