/**
 * @fileoverview tasks.expandAll against a real tasks.json: which tasks it
 * expands, counts, concurrency, and the usage summed over the calls. Only
 * the AI call is mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: string, status: string, subtasks: unknown[] = []) => ({
	id,
	title: `Task ${id}`,
	description: `Task ${id} description`,
	status,
	dependencies: [],
	priority: 'medium',
	subtasks
});

const answer = (tokens: number, model = 'sonnet') => ({
	mainResult: {
		subtasks: [
			{ id: 1, title: 'Step', description: 'Step one', dependencies: [] }
		]
	},
	telemetryData: {
		userId: 'u',
		modelUsed: model,
		providerName: 'claude-code',
		inputTokens: tokens,
		outputTokens: 1,
		totalCost: 0.1,
		currency: 'USD'
	},
	tagInfo: null
});

/** The task ID an AI call is for, read from its prompt */
const taskIdOf = (params: any) => /Task ID: (\d+)/.exec(params.prompt)?.[1];

describe('tasks.expandAll', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-all-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.mkdirSync(path.join(tgDir, 'reports'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: { enableCodebaseAnalysis: false } })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						task('1', 'pending'),
						task('2', 'in-progress'),
						task('3', 'done'),
						task('4', 'pending', [
							{ id: 1, title: 'Old', status: 'pending', dependencies: [] }
						]),
						task('5', 'pending')
					],
					metadata: {}
				}
			})
		);
		generateObject = vi
			.spyOn(AiService.prototype, 'generateObject')
			.mockResolvedValue(answer(10) as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('expands pending and in-progress tasks without subtasks and sums the usage', async () => {
		const done: string[] = [];

		const result = await tmCore.tasks.expandAll(
			{ num: 1 },
			{ onTaskDone: (id) => done.push(id) }
		);

		expect(result).toMatchObject({
			expandedCount: 3,
			skippedCount: 0,
			failedCount: 0,
			tasksToExpand: 3,
			alreadyExpandedCount: 1
		});
		expect(done.sort()).toEqual(['1', '2', '5']);
		expect(result.telemetryData).toMatchObject({
			commandName: 'expand-all-tasks',
			modelUsed: 'sonnet',
			providerName: 'claude-code',
			inputTokens: 30,
			outputTokens: 3,
			totalTokens: 33,
			totalCost: 0.3
		});
		const saved = readFile().master.tasks;
		expect(saved.map((t: any) => t.subtasks.length)).toEqual([1, 1, 0, 1, 1]);
	});

	it('with force also replaces the subtasks of tasks that have them', async () => {
		const result = await tmCore.tasks.expandAll({ num: 1, force: true });

		expect(result).toMatchObject({
			expandedCount: 4,
			tasksToExpand: 4,
			alreadyExpandedCount: 0
		});
		expect(readFile().master.tasks[3].subtasks[0].title).toBe('Step');
	});

	it('counts tasks the complexity report skips, without calling the AI for them', async () => {
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'reports', 'task-complexity-report.json'),
			JSON.stringify({
				meta: {},
				complexityAnalysis: [{ taskId: 2, recommendedSubtasks: 0 }]
			})
		);

		const result = await tmCore.tasks.expandAll({});

		expect(result).toMatchObject({ expandedCount: 2, skippedCount: 1 });
		expect(generateObject).toHaveBeenCalledTimes(2);
	});

	it('counts a failed task and goes on with the rest', async () => {
		generateObject.mockImplementation(async (params: any) => {
			if (taskIdOf(params) === '2') throw new Error('AI down');
			return answer(10) as any;
		});
		const failures: string[] = [];

		const result = await tmCore.tasks.expandAll(
			{},
			{
				onTaskDone: (id, outcome) => {
					if (outcome instanceof Error) failures.push(`${id}: ${outcome.message}`);
				}
			}
		);

		expect(result).toMatchObject({ expandedCount: 2, failedCount: 1 });
		expect(failures).toEqual(['2: AI down']);
		expect(readFile().master.tasks[1].subtasks).toEqual([]);
	});

	it('sums the usage of a call whose result could not be saved', async () => {
		generateObject.mockImplementation(async (params: any) =>
			taskIdOf(params) === '2'
				? ({ ...answer(7), mainResult: { subtasks: [] } } as any)
				: (answer(10) as any)
		);

		const result = await tmCore.tasks.expandAll({ num: 1 });

		expect(result).toMatchObject({ expandedCount: 2, failedCount: 1 });
		expect(result.telemetryData?.inputTokens).toBe(27);
	});

	it('calls onTaskDone once per task, even when it throws', async () => {
		const calls: string[] = [];

		await expect(
			tmCore.tasks.expandAll(
				{ num: 1 },
				{
					onTaskDone: (id) => {
						calls.push(id);
						throw new Error('display broke');
					}
				}
			)
		).rejects.toThrow('display broke');
		expect(new Set(calls).size).toBe(calls.length);
	});

	it('refuses a bad count before any AI call', async () => {
		await expect(tmCore.tasks.expandAll({ num: 'abc' })).rejects.toThrow(
			"isn't a number of subtasks"
		);
		expect(generateObject).not.toHaveBeenCalled();
	});

	it('expands up to three tasks at once, every one saved', async () => {
		let running = 0;
		let most = 0;
		generateObject.mockImplementation(async () => {
			running++;
			most = Math.max(most, running);
			await new Promise((resolve) => setTimeout(resolve, 20));
			running--;
			return answer(1, `model-${running}`) as any;
		});
		const data = readFile();
		for (const id of ['6', '7']) data.master.tasks.push(task(id, 'pending'));
		fs.writeFileSync(tasksPath, JSON.stringify(data));

		const result = await tmCore.tasks.expandAll({});

		expect(most).toBe(3);
		expect(result.expandedCount).toBe(5);
		expect(result.telemetryData?.modelUsed).toBe('Multiple');
		const saved = readFile().master.tasks;
		expect(saved.filter((t: any) => t.subtasks.length === 1)).toHaveLength(6);
	});

	it('reports nothing to do when every open task has subtasks', async () => {
		const data = readFile();
		data.master.tasks = [data.master.tasks[3]];
		fs.writeFileSync(tasksPath, JSON.stringify(data));

		const result = await tmCore.tasks.expandAll({});

		expect(result).toMatchObject({
			tasksToExpand: 0,
			alreadyExpandedCount: 1,
			telemetryData: null
		});
		expect(generateObject).not.toHaveBeenCalled();
	});
});
