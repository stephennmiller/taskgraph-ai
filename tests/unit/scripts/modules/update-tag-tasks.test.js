/**
 * updateTagTasks writes the older 'completed' status as 'done', so add-task,
 * expand and remove-task save it the way every other save does (#247)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { updateTagTasks } from '../../../../scripts/modules/utils/update-tag-tasks.js';

describe('updateTagTasks', () => {
	let dir;
	let file;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-tag-'));
		file = path.join(dir, 'tasks.json');
		fs.writeFileSync(
			file,
			JSON.stringify({
				master: {
					tasks: [
						{
							id: 1,
							title: 'Old',
							status: 'completed',
							dependencies: [],
							subtasks: [{ id: 1, title: 'Sub', status: 'completed' }]
						}
					],
					metadata: {}
				}
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it("writes 'completed' back as 'done', on tasks the change added too", async () => {
		await updateTagTasks(file, 'master', (tagData) => {
			tagData.tasks.push({
				id: 2,
				title: 'New',
				status: 'completed',
				dependencies: []
			});
		});

		const saved = JSON.parse(fs.readFileSync(file, 'utf8')).master.tasks;
		expect(saved.map((t) => t.status)).toEqual(['done', 'done']);
		expect(saved[0].subtasks[0].status).toBe('done');
	});
});
