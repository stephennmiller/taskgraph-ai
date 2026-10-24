/**
 * @fileoverview tasks.expand against a real tasks.json and complexity
 * report. Only the AI call is mocked: subtask count, report integration,
 * force, provenance, ordering, tags, and the save that keeps changes made
 * while the AI was writing.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { getPromptManager } from '../../../src/modules/ai/prompts/prompt-manager.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import legacyInputs from './__snapshots__/expand-prompt-inputs.legacy.json' with {
	type: 'json'
};

const task = (id: string | number, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} description about the command line flags and data`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	priority: 'medium',
	details: `${title} details: build the parser and authentication login`,
	testStrategy: 'unit tests',
	subtasks: [] as unknown[],
	metadata: undefined as unknown,
	...extra
});

const sub = (id: number, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} sub description`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	details: '',
	...extra
});

/** The tasks the legacy prompt inputs were captured from */
function fixture(stringIds = false) {
	const id = (n: number) => (stringIds ? String(n) : n);
	const tasks = [
		task(id(1), 'Set up project scaffolding'),
		task(id(2), 'Implement CLI parser', {
			dependencies: [id(1)],
			subtasks: [
				sub(1, 'Parse flags'),
				sub(2, 'Parse commands', { dependencies: [1] })
			]
		}),
		task(id(3), 'Add user authentication', { dependencies: [id(1), id(2)] }),
		task(id(4), 'Database schema for users'),
		task(id(5), 'Deploy pipeline and release builds', {
			subtasks: [sub(1, 'Configure CI')]
		}),
		task(id(6), 'Display task list in the UI', { status: 'done' }),
		task(id(7), 'Research prompt models for AI integration'),
		task(id(8), 'Add task dependency handling')
	];
	return {
		master: { tasks, metadata: {} },
		feature: { tasks: tasks.slice(0, 4), metadata: {} }
	};
}

const aiSubtask = (id: number, extra = {}) => ({
	id,
	title: `Step ${id}`,
	description: `Step ${id} description`,
	dependencies: [] as Array<string | number>,
	details: 'd',
	testStrategy: 't',
	...extra
});

const answer = (subtasks = [aiSubtask(1), aiSubtask(2)]) => ({
	mainResult: { subtasks },
	telemetryData: { totalTokens: 10 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] }
});

describe('tasks.expand', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	const reportPath = (tag = 'master') =>
		path.join(
			projectDir,
			'.taskgraph',
			'reports',
			tag === 'master'
				? 'task-complexity-report.json'
				: `task-complexity-report_${tag}.json`
		);
	const writeReport = (analysis: unknown[], tag = 'master') =>
		fs.writeFileSync(
			reportPath(tag),
			JSON.stringify({ meta: {}, complexityAnalysis: analysis })
		);

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.mkdirSync(path.join(tgDir, 'reports'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({
				models: {},
				global: { defaultSubtasks: 5, enableCodebaseAnalysis: true }
			})
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write(fixture());
		generateObject = vi
			.spyOn(AiService.prototype, 'generateObject')
			.mockResolvedValue(answer() as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	describe('prompt inputs (eval-gated)', () => {
		// Captured from the legacy expand-task.js on the same fixture
		const scenarios: Record<string, Record<string, any>> = {
			default: { id: '3' },
			research: { id: '3', research: true },
			'prompt + num 0': { id: '4', num: 0, prompt: 'Use Postgres' },
			'num 2': { id: '7', num: '2' },
			'append to subtasks': { id: '2' },
			force: { id: '2', force: true },
			'force research': { id: '5', force: true, research: true },
			'string ids': { id: '3', stringIds: true },
			'string ids force': { id: '2', force: true, stringIds: true },
			'report: prompt + reasoning': {
				id: '3',
				report: [
					{
						taskId: 3,
						complexityScore: 7,
						recommendedSubtasks: 4,
						expansionPrompt: 'Split auth into tokens, sessions and tests',
						reasoning: 'Touches security'
					}
				]
			},
			'report: count only': {
				id: '8',
				report: [{ taskId: 8, complexityScore: 3, recommendedSubtasks: 2 }]
			},
			'report: object prompt, research': {
				id: '1',
				research: true,
				report: [
					{
						taskId: 1,
						recommendedSubtasks: 3,
						expansionPrompt: { text: 'Object prompt' }
					}
				]
			},
			'feature tag + tag report': {
				id: '2',
				tag: 'feature',
				report: [
					{ taskId: 2, recommendedSubtasks: 6, reasoning: 'Feature tag' }
				]
			}
		};

		for (const [name, s] of Object.entries(scenarios)) {
			it(`match the legacy command's: ${name}`, async () => {
				const tag = s.tag ?? 'master';
				write(fixture(s.stringIds));
				if (s.report) writeReport(s.report, tag);
				const loadPrompt = vi.spyOn(getPromptManager(), 'loadPrompt');

				await tmCore.tasks.expand({ ...s, id: s.id, tag });

				const [, { task: promptTask, ...vars }, variant] =
					loadPrompt.mock.calls.find((c) => c[0] === 'expand-task') as any;
				const call = generateObject.mock.calls[0][0] as any;
				const strip = (text: string) => text.split(projectDir).join('<root>');
				expect({
					vars: JSON.parse(strip(JSON.stringify(vars))),
					taskRendered: {
						id: String(promptTask.id),
						title: promptTask.title,
						description: promptTask.description,
						details: promptTask.details,
						subtasks: promptTask.subtasks?.length
					},
					variant,
					role: call.role,
					system: strip(call.systemPrompt),
					prompt: strip(call.prompt)
				}).toEqual((legacyInputs as Record<string, unknown>)[name]);
			});
		}
	});

	it('adds the subtasks, pending, with the AI-chosen dependencies as inferred', async () => {
		generateObject.mockResolvedValue(
			answer([aiSubtask(1), aiSubtask(2, { dependencies: [1] })]) as any
		);

		const result = await tmCore.tasks.expand({ id: '3', num: 2 });

		const saved = readFile().master.tasks[2].subtasks;
		expect(saved.map((s: any) => [s.id, s.status, s.dependencies])).toEqual([
			[1, 'pending', []],
			[2, 'pending', [1]]
		]);
		expect(saved[0].metadata).toBeUndefined();
		expect(saved[1].metadata.dependencySources).toEqual({ '3.1': 'inferred' });
		expect(result.addedSubtasks).toHaveLength(2);
		expect(result.telemetryData).toEqual({ totalTokens: 10 });
		expect(generateObject.mock.calls[0][0]).toMatchObject({
			role: 'main',
			commandName: 'expand-task',
			objectName: 'subtasks'
		});
	});

	it('orders subtasks so none waits on a later one (#515)', async () => {
		generateObject.mockResolvedValue(
			answer([
				aiSubtask(1, { title: 'Wire the UI', dependencies: [2] }),
				aiSubtask(2, { title: 'Build the API', dependencies: ['4'] })
			]) as any
		);

		await tmCore.tasks.expand({ id: '3', num: 2 });

		// Task 3 doesn't depend on task 4, so its subtask can't either
		const [first, second] = readFile().master.tasks[2].subtasks;
		expect([first.id, first.title, first.dependencies]).toEqual([
			1,
			'Build the API',
			[]
		]);
		expect([second.id, second.title, second.dependencies]).toEqual([
			2,
			'Wire the UI',
			[1]
		]);
	});

	it('stores the criteria the AI wrote as unchecked items, and none as no field', async () => {
		generateObject.mockResolvedValue(
			answer([
				aiSubtask(1, {
					acceptanceCriteria: [
						'Returns 401 on a bad password',
						'  Trim me  ',
						''
					]
				}),
				aiSubtask(2, { acceptanceCriteria: null })
			]) as any
		);

		await tmCore.tasks.expand({ id: '3', num: 2 });

		const [first, second] = readFile().master.tasks[2].subtasks;
		expect(first.acceptanceCriteria).toEqual([
			{ text: 'Returns 401 on a bad password', checked: false },
			{ text: 'Trim me', checked: false }
		]);
		expect(second).not.toHaveProperty('acceptanceCriteria');
	});

	it("keeps the task's links and dependencies", async () => {
		const data = fixture();
		data.master.tasks[2].metadata = {
			taskLinks: { 1: 'discovered-from', 4: 'related' }
		} as never;
		write(data);

		await tmCore.tasks.expand({ id: '3', num: 2 });

		const saved = readFile().master.tasks[2];
		expect(saved.metadata).toEqual({
			taskLinks: { 1: 'discovered-from', 4: 'related' }
		});
		// tm-core saves IDs as strings
		expect(saved.dependencies).toEqual(['1', '2']);
	});

	it('appends to existing subtasks, numbering on', async () => {
		await tmCore.tasks.expand({ id: '2', num: 2 });

		expect(
			readFile().master.tasks[1].subtasks.map((s: any) => s.title)
		).toEqual(['Parse flags', 'Parse commands', 'Step 1', 'Step 2']);
	});

	it('uses the research role with research', async () => {
		await tmCore.tasks.expand({ id: '3', research: true });

		expect(generateObject.mock.calls[0][0]).toMatchObject({ role: 'research' });
	});

	describe('complexity report', () => {
		it('skips the task without an AI call when the report recommends 0', async () => {
			writeReport([{ taskId: 3, recommendedSubtasks: 0 }]);

			const result = await tmCore.tasks.expand({ id: '3' });

			expect(result.skipped).toBe('complexity-report');
			expect(generateObject).not.toHaveBeenCalled();
			expect(readFile().master.tasks[2].subtasks).toEqual([]);
		});

		it('still expands when an explicit count outranks the report', async () => {
			writeReport([{ taskId: 3, recommendedSubtasks: 0 }]);

			const result = await tmCore.tasks.expand({ id: '3', num: 2 });

			expect(result.skipped).toBeUndefined();
			expect(generateObject).toHaveBeenCalledOnce();
		});

		it('reads the report given, and proceeds without one that does not parse', async () => {
			const custom = path.join(projectDir, 'custom.json');
			fs.writeFileSync(custom, '{ not json');

			await tmCore.tasks.expand({ id: '3', complexityReportPath: custom });

			expect(generateObject.mock.calls[0][0].prompt).toContain('exactly 5');
		});

		it('warns when the report given does not exist', async () => {
			const warnings: string[] = [];

			await tmCore.tasks.expand(
				{ id: '3', complexityReportPath: path.join(projectDir, 'nope.json') },
				{ onWarning: (message) => warnings.push(message) }
			);

			expect(warnings).toEqual([
				expect.stringContaining('nope.json not found')
			]);
			expect(generateObject).toHaveBeenCalledOnce();
		});

		it.each(['task-complexity.json', 'complexity-report.json'])(
			'falls back to %s, as the legacy MCP tool did',
			async (name) => {
				fs.writeFileSync(
					path.join(projectDir, '.taskgraph', 'reports', name),
					JSON.stringify({
						complexityAnalysis: [{ taskId: 3, recommendedSubtasks: 0 }]
					})
				);

				const result = await tmCore.tasks.expand({ id: '3' });

				expect(result.skipped).toBe('complexity-report');
			}
		);
	});

	describe('subtask count', () => {
		const askedFor = () => generateObject.mock.calls[0][0].prompt as string;

		it('lets the AI choose with 0', async () => {
			await tmCore.tasks.expand({ id: '3', num: 0 });

			expect(askedFor()).toContain('an appropriate number of');
		});

		it('falls back to defaultSubtasks for a missing count', async () => {
			await tmCore.tasks.expand({ id: '3', num: '' });

			expect(askedFor()).toContain('exactly 5');
		});

		it.each([-2, '-2', 'abc', '3abc'])(
			'refuses %j before any AI call',
			async (num) => {
				await expect(tmCore.tasks.expand({ id: '3', num })).rejects.toThrow(
					"isn't a number of subtasks"
				);
				expect(generateObject).not.toHaveBeenCalled();
			}
		);
	});

	describe('force', () => {
		it('replaces the subtasks, dropping dependencies and links on the old ones (#320)', async () => {
			const data = fixture();
			data.master.tasks[0].dependencies = ['2.2'];
			data.master.tasks[0].metadata = {
				dependencySources: { '2.2': 'inferred' },
				taskLinks: { '2.1': 'related' }
			} as never;
			write(data);

			await tmCore.tasks.expand({ id: '2', num: 2, force: true });

			const saved = readFile().master.tasks;
			expect(saved[1].subtasks.map((s: any) => s.title)).toEqual([
				'Step 1',
				'Step 2'
			]);
			expect(saved[0].dependencies).toEqual([]);
			expect(saved[0].metadata).toBeUndefined();
		});

		it('keeps the subtasks when the AI returns none, and fails with its usage', async () => {
			generateObject.mockResolvedValue(answer([]) as any);

			const error = await tmCore.tasks
				.expand({ id: '2', num: 2, force: true })
				.catch((e: unknown) => e);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain('returned no subtasks');
			expect((error as any).telemetryData).toEqual({ totalTokens: 10 });
			expect(readFile().master.tasks[1].subtasks).toHaveLength(2);
		});

		it('leaves the subtasks as they were when the AI call fails', async () => {
			generateObject.mockRejectedValue(new Error('AI down'));

			await expect(
				tmCore.tasks.expand({ id: '2', force: true })
			).rejects.toThrow('AI down');
			expect(readFile().master.tasks[1].subtasks).toHaveLength(2);
		});
	});

	describe('errors', () => {
		it('rejects an unknown task and a subtask ID before any AI call', async () => {
			await expect(tmCore.tasks.expand({ id: '99' })).rejects.toThrow(
				'Task 99 not found'
			);
			await expect(tmCore.tasks.expand({ id: '2.1' })).rejects.toThrow(
				"isn't a task ID"
			);
			expect(generateObject).not.toHaveBeenCalled();
		});

		it('rejects a response without a subtasks array, saving nothing', async () => {
			generateObject.mockResolvedValue({ mainResult: {} } as any);

			await expect(tmCore.tasks.expand({ id: '3' })).rejects.toThrow(
				'valid subtasks array'
			);
			expect(readFile().master.tasks[2].subtasks).toEqual([]);
		});

		it('expands a done task (the CLI never refused one)', async () => {
			await tmCore.tasks.expand({ id: '6', num: 2 });

			expect(readFile().master.tasks[5].subtasks).toHaveLength(2);
		});
	});

	describe('keepExpanded (MCP expand_task)', () => {
		it('refuses a done task', async () => {
			await expect(
				tmCore.tasks.expand({ id: '6', keepExpanded: true })
			).rejects.toThrow('Task 6 is already marked as done');
		});

		it('leaves a task with subtasks alone unless force', async () => {
			const kept = await tmCore.tasks.expand({ id: '2', keepExpanded: true });
			const forced = await tmCore.tasks.expand({
				id: '2',
				keepExpanded: true,
				force: true,
				num: 2
			});

			expect(kept).toMatchObject({
				skipped: 'has-subtasks',
				hadSubtasks: true
			});
			expect(forced).toMatchObject({ hadSubtasks: true });
			expect(forced.task.subtasks).toHaveLength(2);
			expect(generateObject).toHaveBeenCalledOnce();
		});
	});

	describe('tags', () => {
		it('expands in the tag given and leaves the others as they were', async () => {
			await tmCore.tasks.expand({
				id: '2',
				tag: 'feature',
				num: 2,
				force: true
			});

			const saved = readFile();
			expect(saved.feature.tasks[1].subtasks.map((s: any) => s.title)).toEqual([
				'Step 1',
				'Step 2'
			]);
			expect(saved.master.tasks[1].subtasks).toHaveLength(2);
			expect(saved.master.tasks[1].subtasks[0].title).toBe('Parse flags');
		});

		it("refuses a tag that doesn't exist and leaves master alone (#548)", async () => {
			const before = readFile();

			await expect(
				tmCore.tasks.expand({ id: '3', tag: 'featuer', keepExpanded: true })
			).rejects.toMatchObject({
				message: 'Tag "featuer" not found',
				hint: 'Run `taskgraph tags` to see your tags'
			});
			expect(generateObject).not.toHaveBeenCalled();
			expect(readFile()).toEqual(before);
		});
	});

	describe('with another writer during the AI call', () => {
		it('adds the subtasks and keeps what changed meanwhile', async () => {
			generateObject.mockImplementation(async () => {
				const current = readFile();
				current.master.tasks[0].status = 'done';
				current.master.tasks.push(task(9, 'Added meanwhile'));
				write(current);
				return answer() as any;
			});

			await tmCore.tasks.expand({ id: '3', num: 2 });

			const saved = readFile();
			expect(saved.master.tasks[0].status).toBe('done');
			expect(saved.master.tasks.map((t: any) => String(t.id))).toContain('9');
			expect(saved.master.tasks[2].subtasks).toHaveLength(2);
			expect(saved.feature.tasks).toHaveLength(4);
		});

		it('numbers the new subtasks after one added meanwhile (#569)', async () => {
			generateObject.mockImplementation(async () => {
				const current = readFile();
				current.master.tasks[1].subtasks.push(sub(3, 'Added meanwhile'));
				write(current);
				// The AI numbered on from the two subtasks it was shown
				return answer([
					aiSubtask(3),
					aiSubtask(4, { dependencies: [3, 1] })
				]) as any;
			});

			const result = await tmCore.tasks.expand({ id: '2', num: 2 });

			const saved = readFile().master.tasks[1].subtasks;
			expect(saved.map((s: any) => [s.id, s.title, s.dependencies])).toEqual([
				[1, 'Parse flags', []],
				[2, 'Parse commands', [1]],
				[3, 'Added meanwhile', []],
				[4, 'Step 3', []],
				[5, 'Step 4', [4, 1]]
			]);
			expect(saved[4].metadata.dependencySources).toEqual({
				'2.4': 'inferred',
				'2.1': 'inferred'
			});
			expect(result.addedSubtasks.map((s) => s.id)).toEqual([4, 5]);
		});

		it('finds the task in a file saved with string IDs (#392)', async () => {
			write(fixture(true));

			await tmCore.tasks.expand({ id: '3', num: 2 });

			expect(readFile().master.tasks[2].subtasks).toHaveLength(2);
		});

		it('fails clearly when the task was removed during the call', async () => {
			generateObject.mockImplementation(async () => {
				const current = readFile();
				current.master.tasks = current.master.tasks.filter(
					(t: any) => t.id !== 3
				);
				write(current);
				return answer() as any;
			});

			await expect(tmCore.tasks.expand({ id: '3', num: 2 })).rejects.toThrow(
				/removed/
			);
			expect(readFile().master.tasks).toHaveLength(7);
		});
	});
});
