/**
 * @fileoverview Schema version 2 stores subtask IDs as strings (#748). A
 * version 1 file with numeric subtask IDs loads, reads the same as a
 * version 2 file, and saves its subtask IDs as strings; sibling dependencies
 * keep their numbers, which is what makes them siblings.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../../src/modules/storage/adapters/file-storage/index.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const sub = (id: number, title: string, dependencies: unknown[] = []) => ({
	id,
	title,
	description: '',
	status: 'pending',
	dependencies,
	details: ''
});

/** A tasks.json as versions before schema 2 wrote it */
const v1File = () => ({
	master: {
		tasks: [
			{
				id: 1,
				title: 'Set up',
				description: '',
				status: 'pending',
				priority: 'medium',
				dependencies: [],
				details: '',
				testStrategy: '',
				subtasks: [sub(1, 'A'), sub(2, 'B', [1]), sub(3, 'C', [2])]
			},
			{
				id: 2,
				title: 'Parser',
				description: '',
				status: 'pending',
				priority: 'medium',
				dependencies: [1],
				details: '',
				testStrategy: '',
				subtasks: []
			}
		],
		metadata: {}
	}
});

/** The same file with string subtask IDs, as schema 2 writes it */
const v2File = () => {
	const data = v1File();
	for (const task of data.master.tasks) {
		task.subtasks = task.subtasks.map((s) => ({
			...s,
			id: String(s.id) as never
		}));
	}
	return data;
};

describe('subtask IDs stored as strings (#748)', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const subtasksOf = (parent: number) =>
		readFile().master.tasks[parent - 1].subtasks;
	const open = async (data: unknown) => {
		await tmCore?.close();
		fs.writeFileSync(tasksPath, JSON.stringify(data));
		tmCore = await createTmCore({ projectPath: projectDir });
	};

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-subtask-ids-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		await open(v1File());
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('reads an older file with numeric subtask IDs as it reads a new one', async () => {
		const oldList = await tmCore.tasks.list();
		const oldSubtask = await tmCore.tasks.get('1.2');

		await open(v2File());

		expect(oldList).toEqual(await tmCore.tasks.list());
		expect(oldSubtask).toEqual(await tmCore.tasks.get('1.2'));
		expect(oldSubtask.task).toMatchObject({ id: '1.2', title: 'B' });
	});

	it('saves the subtask IDs as strings and stamps the new version on the next write', async () => {
		await tmCore.tasks.updateStatus('1.2', 'in-progress');

		expect(
			subtasksOf(1).map((s: any) => [s.id, s.status, s.dependencies])
		).toEqual([
			['1', 'pending', []],
			['2', 'in-progress', [1]],
			['3', 'pending', [2]]
		]);
		expect(readFile().master.metadata.schemaVersion).toBe(
			CURRENT_SCHEMA_VERSION
		);
		expect(CURRENT_SCHEMA_VERSION).toBe(2);
	});

	it('adds, moves and removes subtasks of an older file', async () => {
		const { subtask } = await tmCore.tasks.addSubtask('1', { title: 'D' });
		expect(subtask.id).toBe('4');

		await tmCore.tasks.move('1.3', '2.1');
		await tmCore.tasks.removeSubtasks(['1.1']);

		expect(subtasksOf(1).map((s: any) => [s.id, s.title])).toEqual([
			['2', 'B'],
			['4', 'D']
		]);
		expect(subtasksOf(2)).toMatchObject([
			{ id: '1', title: 'C', parentId: '2', dependencies: ['1.2'] }
		]);
	});

	it('reads leading zeros as remove-task does, in get and set-status (#864)', async () => {
		expect((await tmCore.tasks.get('01.02')).task).toMatchObject({
			id: '1.2',
			title: 'B'
		});
		expect((await tmCore.tasks.get('02')).task).toMatchObject({ id: '2' });

		await tmCore.tasks.updateStatus('01.03', 'in-progress');
		await tmCore.tasks.updateStatuses(['02'], 'in-progress');

		expect(subtasksOf(1)[2].status).toBe('in-progress');
		expect(readFile().master.tasks[1].status).toBe('in-progress');
	});

	it('finds, changes and numbers after subtasks stored with dotted IDs (#805)', async () => {
		const dotted = v1File();
		dotted.master.tasks[0].subtasks = dotted.master.tasks[0].subtasks.map(
			(s) => ({ ...s, id: `1.${s.id}` as never })
		);
		// Sibling dependencies written either way still point at their subtask
		dotted.master.tasks[0].subtasks[2].dependencies = ['1.2', 1];
		await open(dotted);

		expect((await tmCore.tasks.validateDependencies()).issues).toEqual([]);
		expect((await tmCore.tasks.get('1.2')).task).toMatchObject({
			id: '1.2',
			title: 'B'
		});
		await tmCore.tasks.updateStatus('1.2', 'in-progress');
		await tmCore.tasks.addNote('1.2', 'Started');
		const { subtask } = await tmCore.tasks.addSubtask('1', { title: 'D' });

		expect(subtask.id).toBe('4');
		expect(subtasksOf(1).map((s: any) => [s.id, s.status])).toEqual([
			['1', 'pending'],
			['2', 'in-progress'],
			['3', 'pending'],
			['4', 'pending']
		]);
	});
});
