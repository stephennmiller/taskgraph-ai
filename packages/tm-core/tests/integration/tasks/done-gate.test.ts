/**
 * @fileoverview Integration tests for the acceptance-criteria gate on done.
 * Real FileStorage + TasksDomain on a temp dir; nothing is mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../../../src/common/errors/taskgraph-error.js';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { getUncheckedCriteria } from '../../../src/modules/tasks/utils/acceptance-criteria.js';
import { createTask, createSubtask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('done gate', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup(tasks: Task[], definitionOfDone?: string[]) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-done-gate-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({
				models: {},
				global: definitionOfDone ? { definitionOfDone } : {}
			})
		);
		await new FileStorage(projectDir).saveTasks(tasks, 'master');
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	const readTask = async (id: string) => {
		const tasks = await new FileStorage(projectDir).loadTasks('master');
		return tasks.find((t) => String(t.id) === id) as Task;
	};

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('marks a task with no criteria done', async () => {
		await setup([createTask({ id: '1', title: 'Task 1' })]);

		const result = await tmCore.tasks.updateStatus('1', 'done');

		expect(result.newStatus).toBe('done');
		expect((await readTask('1')).status).toBe('done');
	});

	it('refuses done while legacy string criteria are unchecked', async () => {
		await setup([
			createTask({ id: '1', title: 'Task 1', acceptanceCriteria: ['Login works', 'Tokens expire'] })
		]);

		const tasksPath = path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json');
		const before = fs.readFileSync(tasksPath, 'utf-8');

		const error = await tmCore.tasks
			.updateStatus('1', 'done')
			.catch((e: unknown) => e);

		expect((error as { code: string }).code).toBe(
			ERROR_CODES.CRITERIA_UNCHECKED
		);
		expect(getUncheckedCriteria(error)?.unchecked).toHaveLength(2);
		// The refused write leaves the file byte for byte as it was
		expect(fs.readFileSync(tasksPath, 'utf-8')).toBe(before);
		// and releases the lock: the next write goes through
		await tmCore.tasks.updateStatus('1', 'in-progress');
		expect((await readTask('1')).status).toBe('in-progress');
	});

	it('marks the task done once every criterion is checked', async () => {
		await setup([
			createTask({ id: '1', title: 'Task 1', acceptanceCriteria: ['Login works', 'Tokens expire'] })
		]);

		const checklist = await tmCore.tasks.updateChecklist('1', { check: [1, 2] });
		await tmCore.tasks.updateStatus('1', 'done');

		expect(checklist.unchecked).toEqual([]);
		const saved = await readTask('1');
		expect(saved.status).toBe('done');
		expect(saved.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: true },
			{ text: 'Tokens expire', checked: true }
		]);
	});

	it('marks the task done with force while criteria are unchecked', async () => {
		await setup([createTask({ id: '1', title: 'Task 1', acceptanceCriteria: ['Login works'] })]);

		await tmCore.tasks.updateStatus('1', 'done', undefined, { force: true });

		expect((await readTask('1')).status).toBe('done');
	});

	it('gates every task on the configured Definition of Done', async () => {
		await setup([createTask({ id: '1', title: 'Task 1' })], ['Tests pass']);

		await expect(tmCore.tasks.updateStatus('1', 'done')).rejects.toThrow(
			'1 criterion unchecked on task 1'
		);
		await tmCore.tasks.updateChecklist('1', { check: [1] });
		await tmCore.tasks.updateStatus('1', 'done');

		const saved = await readTask('1');
		expect(saved.definitionOfDoneChecked).toEqual(['Tests pass']);
		expect(saved.status).toBe('done');
	});

	it('gates a subtask on its own criteria only', async () => {
		await setup(
			[
				createTask({
					id: '1',
					title: 'Task 1',
					subtasks: [
						createSubtask({ id: 1, parentId: '1', title: 'Subtask 1', acceptanceCriteria: ['Ok'] }),
						createSubtask({ id: 2, parentId: '1', title: 'Subtask 2' })
					]
				})
			],
			['Tests pass']
		);

		await expect(tmCore.tasks.updateStatus('1.1', 'done')).rejects.toThrow(
			'1 criterion unchecked on subtask 1.1'
		);
		await tmCore.tasks.updateChecklist('1.1', { check: [1] });
		await tmCore.tasks.updateStatus('1.1', 'done');

		const parent = await readTask('1');
		expect(parent.subtasks[0].status).toBe('done');
		expect(parent.subtasks[0].acceptanceCriteria).toEqual([
			{ text: 'Ok', checked: true }
		]);
	});

	it('keeps a parent in progress when its last subtask finishes with its own criteria unchecked', async () => {
		await setup([
			createTask({
				id: '1',
				title: 'Task 1',
				acceptanceCriteria: ['Feature works'],
				subtasks: [createSubtask({ id: 1, parentId: '1', title: 'Subtask 1' })]
			})
		]);

		await tmCore.tasks.updateStatus('1.1', 'done');

		const parent = await readTask('1');
		expect(parent.subtasks[0].status).toBe('done');
		expect(parent.status).toBe('in-progress');
	});

	it('refuses a criterion number the checklist does not have, changing nothing', async () => {
		await setup([createTask({ id: '1', title: 'Task 1', acceptanceCriteria: ['Login works'] })]);

		await expect(
			tmCore.tasks.updateChecklist('1', { check: [1, 5] })
		).rejects.toThrow("Task 1 has 1 criterion; there's no 5");
		expect((await readTask('1')).acceptanceCriteria).toEqual(['Login works']);
	});

	it('refuses a sub-subtask ID rather than checking the subtask it starts with', async () => {
		await setup([
			createTask({
				id: '1',
				title: 'Task 1',
				subtasks: [
					createSubtask({
						id: 2,
						parentId: '1',
						title: 'Sub',
						acceptanceCriteria: ['Sub works']
					})
				]
			})
		]);

		await expect(
			tmCore.tasks.updateChecklist('1.2.3', { check: [1] })
		).rejects.toThrow('1.2.3');
		const sub = (await readTask('1')).subtasks[0];
		expect(sub.acceptanceCriteria).toEqual(['Sub works']);
	});
});
