/**
 * @fileoverview tasks.scope (scope-up / scope-down) against a real
 * tasks.json and complexity report. Only the AI calls are mocked: prompts,
 * kept subtasks, AI nulls, validation before any AI call, edits made during
 * the call, the complexity re-score, and usage.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import legacy from './__snapshots__/scope-prompt-inputs.legacy.json' with {
	type: 'json'
};

/** The task the legacy prompts were captured from */
const fixtureTask = (withSubtasks = true, noTestStrategy = false) => ({
	id: 3,
	title: 'Add user authentication',
	description: 'Let users sign in with email and password',
	details: 'Use bcrypt for hashes and JWT sessions',
	...(noTestStrategy ? {} : { testStrategy: 'Unit tests for login' }),
	priority: 'medium',
	status: 'pending',
	dependencies: [1],
	subtasks: withSubtasks
		? [
				{ id: 1, title: 'Hash passwords', description: 'd', status: 'done', dependencies: [] },
				{ id: 2, title: 'Login route', description: 'd', status: 'pending', dependencies: [1] },
				{ id: 3, title: 'Session tokens', description: 'd', status: 'pending', dependencies: [2] },
				{ id: 5, title: 'Audit log', description: 'd', status: 'in-progress', dependencies: [] }
			]
		: []
});

const otherTask = { id: 4, title: 'Other', description: 'o', status: 'pending', dependencies: [], subtasks: [] };

const adjustAnswer = () => ({
	mainResult: {
		title: 'Adjusted title',
		description: 'Adjusted description',
		details: 'Adjusted details',
		testStrategy: 'Adjusted tests',
		priority: 'high'
	},
	telemetryData: { modelUsed: 'sonnet', inputTokens: 10, outputTokens: 2, totalTokens: 12 }
});

const regenAnswer = () => ({
	mainResult: {
		subtasks: [
			{ id: 1, title: 'New step one', description: 'New step one description', dependencies: [], details: 'New step one details text', status: 'pending', testStrategy: 'ts1' },
			{ id: 2, title: 'New step two', description: 'New step two description', dependencies: ['3.1'], details: 'New step two details text', status: 'pending', testStrategy: 'ts2' }
		]
	},
	telemetryData: { modelUsed: 'sonnet', inputTokens: 20, outputTokens: 4, totalTokens: 24 }
});

describe('tasks.scope', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const readTask = (id = 3) =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks.find(
			(t: { id: unknown }) => String(t.id) === String(id)
		);
	const write = (tasks: unknown[]) =>
		fs.writeFileSync(tasksPath, JSON.stringify({ master: { tasks, metadata: {} } }));
	const reportPath = () =>
		path.join(projectDir, '.taskgraph', 'reports', 'task-complexity-report.json');
	const writeReport = (score: number) =>
		fs.writeFileSync(
			reportPath(),
			JSON.stringify({ meta: {}, complexityAnalysis: [{ taskId: 3, complexityScore: score }] })
		);

	beforeEach(async () => {
		projectDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-scope-')));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.mkdirSync(path.join(tgDir, 'reports'), { recursive: true });
		fs.writeFileSync(path.join(tgDir, 'config.json'), JSON.stringify({ models: {}, global: {} }));
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write([fixtureTask(), otherTask]);
		generateObject = vi
			.spyOn(AiService.prototype, 'generateObject')
			.mockImplementation(async (params: any) =>
				(params.objectName === 'updated_task' ? adjustAnswer() : regenAnswer()) as any
			);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	describe('matches the legacy command (prompts are eval-gated)', () => {
		for (const [name, captured] of Object.entries(legacy)) {
			it(name, async () => {
				const s = captured.scenario as Record<string, any>;
				write([fixtureTask(s.subtasks, s.noTestStrategy)]);
				if (s.complexity) writeReport(s.complexity);

				await tmCore.tasks.scope({
					ids: '3',
					direction: s.dir,
					strength: s.strength,
					prompt: s.prompt,
					research: s.research
				});

				expect(
					generateObject.mock.calls.map(([p]: any[]) => ({
						role: p.role,
						systemPrompt: p.systemPrompt,
						prompt: p.prompt,
						objectName: p.objectName,
						commandName: p.commandName
					}))
				).toEqual(captured.calls);
				// As tm-core stores every task: string task dependencies, parentId
				const { saved: legacySaved } = captured as any;
				const saved = readTask();
				expect({ ...saved, id: Number(saved.id) }).toEqual({
					...legacySaved,
					dependencies: legacySaved.dependencies.map(String),
					subtasks: legacySaved.subtasks.map((s: object) => ({
						...s,
						parentId: '3'
					}))
				});
			});
		}
	});

	it('refuses a bad strength before reading tasks or calling the AI', async () => {
		await expect(
			tmCore.tasks.scope({ ids: '3', direction: 'up', strength: 'extreme' })
		).rejects.toThrow('Invalid strength level: extreme. Must be one of: light, regular, heavy');
		expect(generateObject).not.toHaveBeenCalled();
	});

	it('checks every ID before the first AI call', async () => {
		await expect(
			tmCore.tasks.scope({ ids: '3,99', direction: 'up' })
		).rejects.toThrow('Task with ID 99 not found');
		await expect(
			tmCore.tasks.scope({ ids: '3,3.2', direction: 'down' })
		).rejects.toThrow('"3.2" is a subtask; scope-down takes task IDs');
		await expect(tmCore.tasks.scope({ ids: 'abc', direction: 'up' })).rejects.toThrow(
			'Invalid task ID: abc'
		);
		expect(generateObject).not.toHaveBeenCalled();
		expect(readTask().title).toBe('Add user authentication');
	});

	it('finds tasks stored with string IDs', async () => {
		write([{ ...fixtureTask(false), id: '3' }]);

		const result = await tmCore.tasks.scope({ ids: '3', direction: 'up' });

		expect(result.tasks.map((t) => t.task.title)).toEqual(['Adjusted title']);
	});

	it('keeps stored fields the AI returns empty or null', async () => {
		generateObject.mockResolvedValueOnce({
			mainResult: { title: '', description: null, details: 'New details', priority: 'urgent' },
			telemetryData: null
		} as any);
		write([fixtureTask(false)]);

		await tmCore.tasks.scope({ ids: '3', direction: 'down' });

		expect(readTask()).toMatchObject({
			title: 'Add user authentication',
			description: 'Let users sign in with email and password',
			details: 'New details',
			testStrategy: 'Unit tests for login',
			priority: 'medium'
		});
	});

	it('keeps edits made during the AI call, and a subtask started meanwhile', async () => {
		generateObject.mockImplementationOnce(async () => {
			const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
			data.master.tasks[1].title = 'Edited meanwhile';
			data.master.tasks[0].subtasks[1].status = 'in-progress';
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return adjustAnswer() as any;
		});

		await tmCore.tasks.scope({ ids: '3', direction: 'up' });

		expect(readTask(4).title).toBe('Edited meanwhile');
		expect(readTask().subtasks.map((s: any) => [s.id, s.title])).toEqual([
			[1, 'Hash passwords'],
			[2, 'Login route'],
			[5, 'Audit log'],
			[6, 'New step one'],
			[7, 'New step two']
		]);
	});

	it('keeps a completed subtask and rewrites one with no status', async () => {
		const task = fixtureTask();
		task.subtasks = [
			{ id: 1, title: 'Shipped', description: 'd', status: 'completed', dependencies: [] },
			{ id: 2, title: 'No status', description: 'd', dependencies: [] } as any
		];
		write([task]);

		const result = await tmCore.tasks.scope({ ids: '3', direction: 'up' });

		expect(readTask().subtasks.map((s: any) => [s.id, s.title])).toEqual([
			[1, 'Shipped'],
			[2, 'New step one'],
			[3, 'New step two']
		]);
		expect(result.tasks[0]).toMatchObject({ preserved: 1, generated: 2 });
	});

	it('keeps the pending subtasks when the AI returns none', async () => {
		generateObject
			.mockResolvedValueOnce(adjustAnswer() as any)
			.mockResolvedValueOnce({ mainResult: { subtasks: [] }, telemetryData: null } as any);
		const onWarning = vi.fn();

		const result = await tmCore.tasks.scope({ ids: '3', direction: 'down' }, { onWarning });

		expect(onWarning).toHaveBeenCalledWith(
			'Failed to regenerate subtasks for task 3: the AI returned no subtasks'
		);
		expect(result.tasks[0]).toMatchObject({ regenerated: false, generated: 0 });
		expect(readTask().subtasks).toHaveLength(4);
	});

	it('warns about an unreadable complexity report and scopes without its score', async () => {
		fs.writeFileSync(reportPath(), '{not json');
		const onWarning = vi.fn();

		await tmCore.tasks.scope({ ids: '3', direction: 'up' }, { onWarning });

		expect(onWarning).toHaveBeenCalledWith(
			expect.stringMatching(/^Couldn't read the complexity report: .*; scoping without its score$/)
		);
		expect(readTask().title).toBe('Adjusted title');
	});

	it('fails without bringing back a task removed during the AI call', async () => {
		generateObject.mockImplementationOnce(async () => {
			write([otherTask]);
			return adjustAnswer() as any;
		});

		await expect(tmCore.tasks.scope({ ids: '3', direction: 'up' })).rejects.toThrow(
			'Task 3 was removed while it was being scoped up'
		);
		expect(readTask()).toBeUndefined();
	});

	it('saves the task and warns when the subtasks could not be rewritten', async () => {
		generateObject
			.mockResolvedValueOnce(adjustAnswer() as any)
			.mockRejectedValueOnce(new Error('model overloaded'));
		const onWarning = vi.fn();

		const result = await tmCore.tasks.scope({ ids: '3', direction: 'up' }, { onWarning });

		expect(onWarning).toHaveBeenCalledWith(
			'Failed to regenerate subtasks for task 3: model overloaded'
		);
		expect(result.tasks[0]).toMatchObject({ regenerated: false, generated: 0 });
		expect(readTask().title).toBe('Adjusted title');
		expect(readTask().subtasks).toHaveLength(4);
	});

	it('sums every call into one usage line, and names tasks already saved on a failure', async () => {
		write([fixtureTask(), { ...otherTask, title: 'Other task', details: 'x' }]);

		const result = await tmCore.tasks.scope({ ids: '3,4', direction: 'up' });

		expect(generateObject).toHaveBeenCalledTimes(3);
		expect(result.telemetryData).toMatchObject({
			commandName: 'scope-up',
			inputTokens: 40,
			totalTokens: 48
		});

		generateObject
			.mockResolvedValueOnce(adjustAnswer() as any)
			.mockResolvedValueOnce(regenAnswer() as any)
			.mockRejectedValueOnce(new Error('boom'));
		await expect(tmCore.tasks.scope({ ids: '3,4', direction: 'down' })).rejects.toThrow(
			'boom (task 3 already scoped down)'
		);
	});

	it('re-scores the task in the report only with a session (MCP)', async () => {
		writeReport(5);
		generateObject.mockImplementation(async (params: any) =>
			(params.objectName === 'complexityAnalysis'
				? {
						mainResult: {
							complexityAnalysis: [
								{ taskId: 3, taskTitle: 't', complexityScore: 8, recommendedSubtasks: 4, expansionPrompt: 'e', reasoning: 'r' }
							]
						},
						telemetryData: null
					}
				: params.objectName === 'updated_task'
					? adjustAnswer()
					: regenAnswer()) as any
		);

		const cli = await tmCore.tasks.scope({ ids: '3', direction: 'up' });
		expect(cli.tasks[0].complexity).toBeUndefined();
		expect(generateObject).toHaveBeenCalledTimes(2);

		const mcp = await tmCore.tasks.scope({ ids: '3', direction: 'up', session: {} });
		expect(mcp.tasks[0].complexity).toEqual({ before: 5, after: 8 });
		const report = JSON.parse(fs.readFileSync(reportPath(), 'utf8'));
		expect(report.complexityAnalysis[0].complexityScore).toBe(8);
	});
});
