/**
 * @fileoverview tasks.addSubtask, tasks.move and tasks.moveToTag against a
 * real tasks.json: one locked write each, nothing written when a move fails,
 * and no write to a tag the file doesn't have.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('add-subtask and move through tasks', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const idsIn = (tag: string) =>
		readFile()[tag].tasks.map((t: { id: unknown }) => String(t.id));

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-move-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						{ id: 1, title: 'Set up', dependencies: [], subtasks: [] },
						{ id: 2, title: 'Parser', dependencies: [1], subtasks: [] },
						{ id: 3, title: 'Report', dependencies: [], subtasks: [] }
					],
					metadata: {}
				},
				feature: { tasks: [], metadata: {} }
			})
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('writes nothing when one pair of a batch move fails', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(tmCore.tasks.move('3,2', '8,1')).rejects.toThrow(
			'Task with ID 1 already exists'
		);

		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('moves every pair of a batch in one write', async () => {
		const result = await tmCore.tasks.move('3,2', '8,9');

		expect(result.moves.map((m) => m.message)).toEqual([
			'Moved task 3 to new ID 8',
			'Moved task 2 to new ID 9'
		]);
		expect(idsIn('master')).toEqual(['1', '8', '9']);
	});

	it("moves dependencies on the moved task's subtasks and their parentId (#654)", async () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						{
							id: '1',
							title: 'Set up',
							dependencies: [],
							subtasks: [
								{ id: 1, parentId: '1', title: 'A', dependencies: [] },
								{ id: 2, parentId: '1', title: 'B', dependencies: [1] }
							]
						},
						{ id: '2', title: 'Parser', dependencies: ['1.1'], subtasks: [] },
						{ id: '3', title: 'Report', dependencies: ['1.2'], subtasks: [] },
						{
							id: '4',
							title: 'Ship',
							dependencies: [],
							subtasks: [
								{ id: 1, parentId: '4', title: 'C', dependencies: ['1.1'] }
							]
						}
					],
					metadata: {}
				}
			})
		);

		await tmCore.tasks.move('1', '9');

		const tasks = readFile().master.tasks;
		const byId = (id: string) =>
			tasks.find((t: { id: unknown }) => String(t.id) === id);
		expect(byId('2').dependencies).toEqual(['9.1']);
		expect(byId('3').dependencies).toEqual(['9.2']);
		expect(byId('4').subtasks[0].dependencies).toEqual(['9.1']);
		expect(byId('9').subtasks).toMatchObject([
			{ id: '1', parentId: '9', dependencies: [] },
			{ id: '2', parentId: '9', dependencies: [1] }
		]);
	});

	it('gives a subtask moved to another parent, or a task made a subtask, its new parentId (#673)', async () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						{
							id: '1',
							title: 'Set up',
							dependencies: [],
							subtasks: [{ id: 1, parentId: '1', title: 'A', dependencies: [] }]
						},
						{ id: '2', title: 'Parser', dependencies: [], subtasks: [] },
						{ id: '3', title: 'Report', dependencies: [], subtasks: [] }
					],
					metadata: {}
				}
			})
		);

		await tmCore.tasks.move('1.1,3', '2.1,2.2');

		const [, parser] = readFile().master.tasks;
		expect(parser.subtasks).toMatchObject([
			{ id: '1', parentId: '2' },
			{ id: '2', parentId: '2' }
		]);
	});

	it('refuses a tag the file does not have instead of creating it', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(
			tmCore.tasks.addSubtask('1', { title: 'x' }, { tag: 'nope' })
		).rejects.toThrow('Tag "nope" not found');
		await expect(tmCore.tasks.move('3', '8', { tag: 'nope' })).rejects.toThrow(
			'Tag "nope" not found'
		);

		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('adds a subtask and saves it under its parent', async () => {
		const { subtask, tag } = await tmCore.tasks.addSubtask('2', {
			title: 'Read files',
			dependencies: '1'
		});

		expect(tag).toBe('master');
		expect(subtask).toMatchObject({ id: '1', dependencies: ['1'] });
		expect(readFile().master.tasks[1].subtasks[0].title).toBe('Read files');
	});

	it('lets a subtask parent be renumbered and its old ID reused (#701)', async () => {
		await tmCore.tasks.addSubtask('2', { title: 'Read files' });
		await tmCore.tasks.move('2', '20');
		await tmCore.tasks.move('3', '2');

		const { subtask } = await tmCore.tasks.addSubtask('20', {
			fromTaskId: '2'
		});

		expect(subtask).toMatchObject({ id: '2', title: 'Report' });
		expect(idsIn('master')).toEqual(['1', '20']);
		expect(readFile().master.tasks[1].subtasks[0]).not.toHaveProperty(
			'parentTaskId'
		);
	});

	it('moves a task to another tag without writing a tag field that a rename would leave stale (#702)', async () => {
		await tmCore.tasks.moveToTag(['3'], 'master', 'feature');
		await tmCore.tasks.renameTag('feature', 'later');

		expect(readFile().later.tasks[0]).not.toHaveProperty('tag');
	});

	it('drops the stale tag and parentTaskId an older version saved (#701, #702)', async () => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				feature: {
					tasks: [
						{
							id: 4,
							title: 'Moved',
							tag: 'feature',
							parentTaskId: 9,
							dependencies: [],
							subtasks: [{ id: 1, title: 'Step', parentTaskId: 2 }]
						}
					],
					metadata: {}
				}
			})
		);
		await tmCore.tasks.renameTag('feature', 'later');

		const { task } = await tmCore.tasks.get('4', 'later');

		expect(task).not.toHaveProperty('tag');
		expect(task).not.toHaveProperty('parentTaskId');
		expect((task as Task).subtasks[0]).not.toHaveProperty('parentTaskId');
	});

	it('moves a task to another tag and saves both tags', async () => {
		const result = await tmCore.tasks.moveToTag(['3'], 'master', 'feature');

		expect(result.movedTasks).toEqual([
			{ id: '3', fromTag: 'master', toTag: 'feature' }
		]);
		expect(idsIn('master')).toEqual(['1', '2']);
		expect(idsIn('feature')).toEqual(['3']);
	});
});
