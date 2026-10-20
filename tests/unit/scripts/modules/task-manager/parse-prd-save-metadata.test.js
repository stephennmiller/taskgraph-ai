/**
 * parse-prd's save keeps the tag's existing metadata (e.g. schemaVersion)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { saveTasksToFile } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const logger = { report: () => {} };

describe('saveTasksToFile metadata', () => {
	let dir;
	let tasksPath;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parse-prd-'));
		tasksPath = path.join(dir, 'tasks.json');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test('keeps schemaVersion and other existing tag metadata', () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [],
					metadata: {
						version: '1.0.0',
						schemaVersion: 1,
						created: '2020-01-01T00:00:00.000Z',
						custom: 'kept'
					}
				},
				other: { tasks: [], metadata: { schemaVersion: 1 } }
			})
		);

		saveTasksToFile(tasksPath, [{ id: 1, title: 'T' }], 'master', logger);

		const saved = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		expect(saved.master.metadata).toMatchObject({
			version: '1.0.0',
			schemaVersion: 1,
			created: '2020-01-01T00:00:00.000Z',
			custom: 'kept'
		});
		expect(saved.master.tasks).toHaveLength(1);
		expect(saved.other.metadata.schemaVersion).toBe(1);
	});

	test('a new tag gets metadata without inventing a schemaVersion', () => {
		saveTasksToFile(tasksPath, [{ id: 1, title: 'T' }], 'master', logger);

		const saved = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		expect(saved.master.metadata.created).toBeDefined();
		expect(saved.master.metadata).not.toHaveProperty('schemaVersion');
	});
});
