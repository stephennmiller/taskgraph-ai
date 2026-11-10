/**
 * @fileoverview The write funnel refuses a status, priority or ID problem a
 * write adds, through each of its entries (mutateTags, modifyTask,
 * updateTaskStatus), and leaves one the file already held (#1119).
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../../common/types/index.js';
import { findStoredTaskProblems } from '../../../tasks/validation/stored-tasks.js';
import { FileStorage } from './index.js';

let projectRoot: string;
let tasksPath: string;

const task = (id: unknown, fields: Record<string, unknown> = {}) =>
	({
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...fields
	}) as unknown as Task;

const subtask = (id: unknown, fields: Record<string, unknown> = {}) => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	...fields
});

const writeTasks = (tasks: unknown[]) =>
	fs.writeFileSync(
		tasksPath,
		JSON.stringify({ master: { tasks, metadata: {} } })
	);
const readText = () => fs.readFileSync(tasksPath, 'utf8');

/** Runs `change` on master's tasks through mutateTags */
const mutate = (change: (tasks: Task[]) => void) =>
	new FileStorage(projectRoot).mutateTags((tags) => {
		change(tags.get('master') as Task[]);
		return { changed: ['master'], result: undefined };
	});

beforeEach(() => {
	projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'write-validation-'));
	fs.mkdirSync(path.join(projectRoot, '.taskgraph', 'tasks'), {
		recursive: true
	});
	tasksPath = path.join(projectRoot, '.taskgraph', 'tasks', 'tasks.json');
	writeTasks([task('1', { subtasks: [subtask('1')] }), task('2')]);
});

afterEach(() => {
	fs.rmSync(projectRoot, { recursive: true, force: true });
});

describe('the write funnel refuses a bad value a write adds', () => {
	const cases: Array<[string, (tasks: Task[]) => void, RegExp]> = [
		[
			'an unknown task status',
			(tasks) => Object.assign(tasks[1], { status: 'finished' }),
			/Task 2 has status "finished"/
		],
		[
			'an unknown subtask status',
			(tasks) => Object.assign(tasks[0].subtasks[0], { status: 'wip' }),
			/Subtask 1\.1 has status "wip"/
		],
		[
			'an unknown priority',
			(tasks) => Object.assign(tasks[1], { priority: 'urgent' }),
			/Task 2 has priority "urgent"/
		],
		[
			'an unknown subtask priority',
			(tasks) => Object.assign(tasks[0].subtasks[0], { priority: 1 }),
			/Subtask 1\.1 has priority 1/
		],
		[
			'task ID 0',
			(tasks) => tasks.push(task('0')),
			/Task 0 has an ID that can't be used/
		],
		[
			'a task ID past 2^53',
			(tasks) => tasks.push(task('99999999999999999999')),
			/Task 99999999999999999999 has an ID that can't be used/
		],
		[
			'a dotted task ID',
			(tasks) => tasks.push(task('4.1')),
			/Task 4\.1 has an ID that can't be used/
		],
		[
			'a duplicate task ID',
			(tasks) => tasks.push(task('2')),
			/2 tasks have the ID 2/
		],
		[
			'a duplicate task ID stored as a number',
			(tasks) => tasks.push(task(2)),
			/2 tasks have the ID 2/
		],
		[
			'subtask ID 0',
			(tasks) => tasks[0].subtasks.push(subtask('0') as never),
			/Subtask 1\.0 has an ID that can't be used/
		],
		[
			'a duplicate subtask ID',
			(tasks) => tasks[0].subtasks.push(subtask('1') as never),
			/2 subtasks have the ID 1\.1/
		]
	];

	it.each(cases)('%s', async (_name, change, message) => {
		const before = readText();

		await expect(mutate(change)).rejects.toThrow(message);

		expect(readText()).toBe(before);
	});

	it('names the tag, and carries a hint', async () => {
		const error = await mutate((tasks) =>
			Object.assign(tasks[1], { status: 'finished' })
		).catch((e) => e);

		expect(error.message).toMatch(/^Can't save tag 'master': Task 2 has/);
		expect(error.code).toBe('VALIDATION_ERROR');
		expect(error.hint).toBeTruthy();
	});

	it('refuses through modifyTask', async () => {
		await expect(
			new FileStorage(projectRoot).modifyTask('2', () => ({
				priority: 'urgent' as never
			}))
		).rejects.toThrow(/Task 2 has priority "urgent"/);
	});

	it('refuses through updateTaskStatus, which skips the parent settle', async () => {
		await expect(
			new FileStorage(projectRoot).updateTaskStatus('2', 'finished' as never)
		).rejects.toThrow(/Task 2 has status "finished"/);
	});

	it('refuses through appendTasks', async () => {
		await expect(
			new FileStorage(projectRoot).appendTasks([task('9', { status: 'todo' })])
		).rejects.toThrow(/has status "todo"/);
	});

	it('refuses a tag the write creates', async () => {
		await expect(
			new FileStorage(projectRoot).mutateTags((tags) => {
				tags.set('feature', [task('1', { status: 'finished' })]);
				return { changed: ['feature'], result: undefined };
			})
		).rejects.toThrow(/Can't save tag 'feature': Task 1 has status/);
	});
});

describe('a bad value the file already held', () => {
	beforeEach(() => {
		writeTasks([
			task('1', { status: 'finished' }),
			task('2', { priority: 'urgent' }),
			task('3'),
			task('3'),
			task('0')
		]);
	});

	it('still loads', async () => {
		const tasks = await new FileStorage(projectRoot).loadTasks('master');

		expect(tasks.map((t) => t.status)[0]).toBe('finished');
	});

	it("doesn't stop a write elsewhere", async () => {
		await mutate((tasks) => Object.assign(tasks[2], { title: 'Renamed' }));

		expect(JSON.parse(readText()).master.tasks[2].title).toBe('Renamed');
	});

	it('can be repaired, one value at a time', async () => {
		const storage = new FileStorage(projectRoot);

		await storage.updateTaskStatus('1', 'done');
		await storage.modifyTask('2', () => ({ priority: 'high' }));
		await mutate((tasks) => {
			tasks.splice(3, 2);
		});

		expect(findStoredTaskProblems(JSON.parse(readText()).master.tasks)).toEqual(
			[]
		);
	});

	it('refuses one more task under an ID two already share', async () => {
		await expect(mutate((tasks) => tasks.push(task('3')))).rejects.toThrow(
			/3 tasks have the ID 3/
		);
	});

	it('refuses a new bad value next to the old ones', async () => {
		await expect(
			mutate((tasks) => Object.assign(tasks[2], { status: 'wip' }))
		).rejects.toThrow(/Task 3 has status "wip"/);
	});
});

describe('findStoredTaskProblems', () => {
	it('finds nothing in valid tasks, with missing status and priority', () => {
		expect(
			findStoredTaskProblems([
				task(1, { priority: undefined, subtasks: [{ id: 1, title: 'a' }] }),
				task('2', { status: 'cancelled', priority: 'critical' })
			])
		).toEqual([]);
	});

	it('survives what a hand edit can leave, and never prints a non-numeric ID', () => {
		const problems = findStoredTaskProblems([
			null,
			task('\u001b[31mx', { subtasks: [7, subtask('y')] }),
			task('5', { subtasks: 'none' })
		]);

		expect(problems.map((p) => p.message)).toEqual([
			"Task #1 has an ID that isn't a number",
			"Task #2 has an ID that isn't a number",
			"Subtask #2.#1 has an ID that isn't a number",
			"Subtask #2.#2 has an ID that isn't a number"
		]);
		expect(findStoredTaskProblems('nope')).toEqual([]);
	});
});
