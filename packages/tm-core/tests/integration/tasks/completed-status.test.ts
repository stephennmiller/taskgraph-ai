/**
 * @fileoverview A tasks.json that says 'completed' (the older spelling of
 * 'done') loads everywhere: list and next read it as 'done', next agrees
 * with the rule the MCP tool runs on the raw file, and the next save
 * writes 'done' back.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { selectNextTask } from '../../../src/modules/tasks/utils/next-task.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const rawTasks = () => [
	{
		id: 1,
		title: 'Set up the database',
		description: 'Create the schema',
		status: 'completed',
		priority: 'high',
		dependencies: [],
		subtasks: [
			{
				id: 1,
				title: 'Write migrations',
				description: 'Initial tables',
				status: 'completed',
				dependencies: []
			}
		]
	},
	{
		id: 2,
		title: 'Build the login API',
		description: 'JWT auth',
		status: 'pending',
		priority: 'medium',
		dependencies: [1],
		subtasks: []
	}
];

describe("a top-level 'completed' status", () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf-8'));

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-completed-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks: rawTasks() } }, null, 2)
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('lists the task as done', async () => {
		const { tasks } = await tmCore.tasks.list();

		expect(tasks.map((t) => [t.id, t.status])).toEqual([
			['1', 'done'],
			['2', 'pending']
		]);
		expect(tasks[0].subtasks[0].status).toBe('done');
	});

	it('picks the same next task as the raw-file rule the MCP tool uses', async () => {
		const next = await tmCore.tasks.getNext();

		expect(next?.id).toBe('2');
		expect(String(selectNextTask(rawTasks() as never)?.id)).toBe('2');
	});

	it("writes 'done' back on the next save", async () => {
		await tmCore.tasks.updateStatus('2', 'in-progress');

		const saved = readFile().master.tasks;
		expect(saved[0].status).toBe('done');
		expect(saved[0].subtasks[0].status).toBe('done');
		expect(saved[1].status).toBe('in-progress');
	});
});
