/**
 * parse-prd --append against the tag as it is when the tasks are saved:
 * a task added while the model ran survives (#317), and a new task's
 * dependency on an existing task is kept (#342)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { archivePathFor } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ai = vi.hoisted(() => ({
	generateObjectService: vi.fn(),
	streamObjectService: vi.fn(),
	logAiUsage: vi.fn()
}));
vi.mock('../../../../../scripts/modules/ai-services-unified.js', () => ai);

vi.mock(
	'../../../../../scripts/modules/config-manager.js',
	async (original) => ({
		...(await original<object>()),
		getDebugFlag: () => false,
		getDefaultPriority: () => 'medium',
		hasCodebaseAnalysis: () => false
	})
);

import parsePRD from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd.js';
import { processTasks } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const generated = (id: number, dependencies: number[] = []) => ({
	id,
	title: `New ${id}`,
	description: 'Do it',
	details: '',
	testStrategy: '',
	priority: 'medium',
	dependencies,
	status: 'pending'
});

const existing = (id: number) => ({
	id,
	title: `Old ${id}`,
	description: '',
	status: 'pending',
	dependencies: [],
	subtasks: []
});

const mcpLog = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	success: vi.fn()
};

describe('parse-prd --append', () => {
	let dir: string;
	let tasksPath: string;
	let prdPath: string;

	const readTag = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks as Array<{
			id: number;
			title: string;
			dependencies: number[];
		}>;
	const writeTag = (tasks: object[]) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks, metadata: {} } }, null, 2)
		);
	const append = () =>
		parsePRD(prdPath, tasksPath, 0, {
			append: true,
			tag: 'master',
			projectRoot: dir,
			mcpLog
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parse-prd-append-'));
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		prdPath = path.join(dir, 'prd.txt');
		fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
		fs.writeFileSync(prdPath, 'Build the reporting page.');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('keeps a task added during the AI call and gives the new tasks other IDs', async () => {
		writeTag([existing(1), existing(2)]);
		ai.generateObjectService.mockImplementation(async () => {
			// Another command adds task 3 while the model is running
			writeTag([existing(1), existing(2), existing(3)]);
			return {
				mainResult: { tasks: [generated(3, [1]), generated(4, [3])] },
				telemetryData: null
			};
		});

		await append();

		const tasks = readTag();
		expect(tasks.map((t) => [t.id, t.title])).toEqual([
			['1', 'Old 1'],
			['2', 'Old 2'],
			['3', 'Old 3'],
			['4', 'New 3'],
			['5', 'New 4']
		]);
		// Dependencies follow the new tasks; the one on existing task 1 stays
		expect(tasks[3].dependencies).toEqual(['1']);
		expect(tasks[4].dependencies).toEqual(['4']);
	});

	it('keeps a status change made during the AI call', async () => {
		writeTag([existing(1)]);
		ai.generateObjectService.mockImplementation(async () => {
			writeTag([{ ...existing(1), status: 'done' }]);
			return {
				mainResult: { tasks: [generated(2)] },
				telemetryData: null
			};
		});

		await append();

		expect(readTag()[0]).toMatchObject({ id: '1', status: 'done' });
	});

	it('keeps a new task dependency on an existing task', async () => {
		writeTag(Array.from({ length: 10 }, (_, i) => existing(i + 1)));
		ai.generateObjectService.mockResolvedValue({
			mainResult: { tasks: [generated(11, [3])] },
			telemetryData: null
		});

		await append();

		expect(readTag()[10]).toMatchObject({ id: '11', dependencies: ['3'] });
	});

	it('keeps a dependency on a task archived during the AI call', async () => {
		writeTag([existing(1), existing(2)]);
		ai.generateObjectService.mockImplementation(async () => {
			// Another command archives task 2 while the model is running
			fs.writeFileSync(
				archivePathFor(tasksPath),
				JSON.stringify({
					master: {
						tasks: [{ ...existing(2), status: 'done' }],
						metadata: { highestId: 2 }
					}
				})
			);
			writeTag([existing(1)]);
			return {
				mainResult: { tasks: [generated(3, [2])] },
				telemetryData: null
			};
		});

		await append();

		expect(readTag()[1]).toMatchObject({ id: '3', dependencies: ['2'] });
	});

	it('lists the existing tasks in the prompt', async () => {
		writeTag([existing(1), existing(2)]);
		ai.generateObjectService.mockResolvedValue({
			mainResult: { tasks: [generated(3)] },
			telemetryData: null
		});

		await append();

		const { prompt } = ai.generateObjectService.mock.calls[0][0];
		expect(prompt).toContain('- 1: Old 1\n- 2: Old 2');
	});
});

describe('parse-prd without --append or --force', () => {
	let dir: string;
	let tasksPath: string;
	let prdPath: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-parse-prd-empty-'));
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		prdPath = path.join(dir, 'prd.txt');
		fs.mkdirSync(path.dirname(tasksPath), { recursive: true });
		fs.writeFileSync(prdPath, 'Build the reporting page.');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('fails instead of replacing tasks added to the empty tag during the AI call', async () => {
		ai.generateObjectService.mockImplementation(async () => {
			fs.writeFileSync(
				tasksPath,
				JSON.stringify({ master: { tasks: [existing(1)], metadata: {} } })
			);
			return {
				mainResult: { tasks: [generated(1)] },
				telemetryData: null
			};
		});

		await expect(
			parsePRD(prdPath, tasksPath, 0, {
				tag: 'master',
				projectRoot: dir,
				mcpLog
			})
		).rejects.toThrow(/--append.*--force/);

		const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;
		expect(tasks.map((t: { title: string }) => t.title)).toEqual(['Old 1']);
	});
});

describe('processTasks', () => {
	it('keeps a dependency on an existing task instead of dropping it', () => {
		const tasks = processTasks(
			[generated(11, [3]), generated(12, [11, 3])],
			11,
			Array.from({ length: 10 }, (_, i) => i + 1),
			'medium'
		);

		expect(tasks.map((t) => t.dependencies)).toEqual([[3], [11, 3]]);
		expect(tasks[0].metadata.dependencySources).toEqual({ 3: 'inferred' });
	});
});
