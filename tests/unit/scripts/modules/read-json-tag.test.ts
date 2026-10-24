/**
 * Legacy readJSON refuses a tag it was given but the file lacks, rather than
 * returning master's tasks for it (#548)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readJSON } from '../../../../scripts/modules/utils.js';

describe('readJSON with a tag', () => {
	let dir: string;
	let tasksPath: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-read-json-tag-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: [{ id: 1, title: 'M', status: 'pending' }] },
				feature: { tasks: [{ id: 1, title: 'F', status: 'pending' }] }
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('reads the tag given', () => {
		expect(readJSON(tasksPath, dir, 'feature').tasks[0].title).toBe('F');
	});

	it('fails on a tag the file lacks, naming it and `taskgraph tags`', () => {
		expect(() => readJSON(tasksPath, dir, 'featuer')).toThrow(
			expect.objectContaining({
				message: 'Tag "featuer" not found',
				hint: 'Run `taskgraph tags` to see your tags'
			})
		);
		expect(() => readJSON(tasksPath, dir, '__proto__')).toThrow(
			'Tag "__proto__" not found'
		);
	});

	it('reads the active tag when none is given', () => {
		expect(readJSON(tasksPath, dir).tasks[0].title).toBe('M');
	});
});
