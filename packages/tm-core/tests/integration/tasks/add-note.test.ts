/**
 * @fileoverview tasks.addNote against a real tasks.json: the note is saved as
 * written and timestamped, on a task or a subtask, and nothing else changes.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../src/common/errors/taskgraph-error.js';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import {
	createSubtask,
	createTask
} from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('tasks.addNote', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const readTasks = async (): Promise<Task[]> =>
		new FileStorage(projectDir).loadTasks('master');

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-add-note-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		await new FileStorage(projectDir).saveTasks(
			[
				createTask({
					id: '1',
					title: 'Build the login API',
					details: 'Use JWT',
					subtasks: [
						createSubtask({ id: 1, parentId: '1', title: 'Hash passwords' }),
						createSubtask({ id: 2, parentId: '1', title: 'Issue tokens' })
					]
				}),
				createTask({ id: '2', title: 'Add the sign-up form' })
			],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('appends the note to a task as written, with its timestamp', async () => {
		const note = await tmCore.tasks.addNote(
			'1',
			'Chose argon2 over bcrypt\n  - already a dependency\n'
		);

		expect(note).toMatchObject({
			id: '1',
			title: 'Build the login API',
			isSubtask: false,
			text: 'Chose argon2 over bcrypt\n  - already a dependency'
		});
		const [task] = await readTasks();
		expect(task.details).toBe(
			`Use JWT\n<info added on ${note.addedAt}>\nChose argon2 over bcrypt\n  - already a dependency\n</info added on ${note.addedAt}>`
		);
	});

	it('appends to a subtask and leaves its siblings alone', async () => {
		const note = await tmCore.tasks.addNote('1.2', 'Tokens expire after 1h');

		expect(note).toMatchObject({
			id: '1.2',
			title: 'Issue tokens',
			isSubtask: true
		});
		const [task, other] = await readTasks();
		expect(task.details).toBe('Use JWT');
		expect(task.subtasks[0].details ?? '').not.toContain('info added');
		expect(task.subtasks[1].details).toContain('Tokens expire after 1h');
		expect(other.details ?? '').toBe('');
	});

	it('keeps every note when several are added', async () => {
		await tmCore.tasks.addNote('2', 'First');
		await tmCore.tasks.addNote('2', 'Second');

		const details = (await readTasks())[1].details;
		expect(details.indexOf('First')).toBeLessThan(details.indexOf('Second'));
		expect(details.match(/<info added on /g)).toHaveLength(2);
	});

	it('refuses an unknown task or subtask and leaves the file alone', async () => {
		const before = fs.readFileSync(tasksPath, 'utf-8');

		for (const id of ['9', '1.9']) {
			const error = await tmCore.tasks.addNote(id, 'x').catch((e) => e);
			expect(error.code).toBe(ERROR_CODES.TASK_NOT_FOUND);
		}
		expect(fs.readFileSync(tasksPath, 'utf-8')).toBe(before);
	});

	it('refuses an empty note before touching the file', async () => {
		const before = fs.readFileSync(tasksPath, 'utf-8');

		const error = await tmCore.tasks.addNote('1', '  \n').catch((e) => e);

		expect(error.code).toBe(ERROR_CODES.INVALID_INPUT);
		expect(fs.readFileSync(tasksPath, 'utf-8')).toBe(before);
	});
});
