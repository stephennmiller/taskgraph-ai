/**
 * @fileoverview tasks.updateFrom (update --from) against a real tasks.json.
 * Only the AI call is mocked: which tasks are sent and changed, what the
 * rewrite keeps (stored fields, subtasks, links, dependency marks), other
 * tags, and the save that keeps changes made while the AI was writing.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const stored = (id: string, extra = {}) => ({
	id,
	title: `Task ${id}`,
	description: `Task ${id} description`,
	status: 'pending',
	dependencies: [] as string[],
	priority: 'high',
	details: `Details ${id}`,
	testStrategy: `Strategy ${id}`,
	subtasks: [] as unknown[],
	...extra
});

const fromAi = (id: number, extra = {}) => ({
	id,
	title: `Task ${id}, revised`,
	description: 'Revised description',
	status: 'pending',
	dependencies: [] as Array<string | number>,
	priority: 'medium',
	details: 'Revised details',
	testStrategy: 'Revised strategy',
	subtasks: null as unknown[] | null,
	...extra
});

const reply = (tasks: unknown) => ({
	mainResult: { tasks },
	telemetryData: { totalTokens: 9 } as any,
	tagInfo: { currentTag: 'master', availableTags: ['master'] },
	providerName: 'claude-code',
	modelId: 'sonnet'
});

describe('tasks.updateFrom', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const savedTasks = () => readFile().master.tasks;
	const write = (tasks: unknown[], extra = {}) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks, metadata: {} }, ...extra })
		);
	const answer = (...tasks: unknown[]) =>
		generateObject.mockResolvedValue(reply(tasks) as any);
	const update = (input = {}) =>
		tmCore.tasks.updateFrom({ from: 2, prompt: 'New direction', ...input });

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-from-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write([
			stored('1'),
			stored('2'),
			stored('3', { status: 'in-progress' }),
			stored('4', { status: 'done' })
		]);
		generateObject = vi.spyOn(AiService.prototype, 'generateObject');
		answer(fromAi(2), fromAi(3));
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('rewrites the unfinished tasks from the ID on, and only those', async () => {
		// The AI also returns tasks it wasn't sent: the done one and one before --from
		answer(
			fromAi(1),
			fromAi(2),
			fromAi(3, { status: 'in-progress' }),
			fromAi(4, { status: 'pending' })
		);

		const result = await update();

		const sent = (generateObject.mock.calls[0][0] as any).prompt;
		expect(sent).toContain('Task 3 description');
		expect(sent).not.toContain('"title": "Task 4"');
		expect(generateObject.mock.calls[0][0]).toMatchObject({
			role: 'main',
			commandName: 'update-tasks',
			objectName: 'tasks'
		});
		expect(savedTasks().map((t: any) => [t.id, t.title, t.status])).toEqual([
			['1', 'Task 1', 'pending'],
			['2', 'Task 2, revised', 'pending'],
			['3', 'Task 3, revised', 'in-progress'],
			['4', 'Task 4', 'done']
		]);
		expect(result.sentCount).toBe(2);
		expect(result.updatedTasks.map((t) => t.id)).toEqual(['2', '3']);
		expect(result.telemetryData).toEqual({ totalTokens: 9 });
	});

	it('keeps stored fields and subtasks the AI leaves out or nulls (#229, #286)', async () => {
		const criteria = [{ text: 'Works', checked: true }];
		const subtask = {
			id: 1,
			title: 'Sub',
			status: 'pending',
			dependencies: [],
			testStrategy: 'Check it',
			assignee: 'lee',
			acceptanceCriteria: [{ text: 'Sub works', checked: false }]
		};
		write([
			stored('2', {
				acceptanceCriteria: criteria,
				definitionOfDoneChecked: ['Tests pass'],
				github: { issue: 3 },
				subtasks: [subtask]
			}),
			stored('3', { subtasks: [subtask] })
		]);
		answer(
			fromAi(2, {
				priority: null,
				details: null,
				testStrategy: null,
				subtasks: [{ ...subtask, title: 'Sub, revised', testStrategy: null }]
			}),
			fromAi(3, { subtasks: null })
		);

		await update();

		const [two, three] = savedTasks();
		expect(two).toMatchObject({
			title: 'Task 2, revised',
			priority: 'high',
			details: 'Details 2',
			testStrategy: 'Strategy 2',
			acceptanceCriteria: criteria,
			definitionOfDoneChecked: ['Tests pass'],
			github: { issue: 3 }
		});
		expect(two.subtasks[0]).toMatchObject({
			title: 'Sub, revised',
			testStrategy: 'Check it',
			assignee: 'lee',
			acceptanceCriteria: [{ text: 'Sub works', checked: false }]
		});
		expect(three.subtasks).toMatchObject([subtask]);
	});

	it('marks added dependencies as inferred and keeps links on tasks and subtasks', async () => {
		write([
			stored('1'),
			stored('2', {
				dependencies: ['1'],
				metadata: { taskLinks: { 1: 'related' } },
				subtasks: [
					{
						id: 1,
						title: 'Sub',
						status: 'pending',
						dependencies: [],
						metadata: { taskLinks: { 3: 'discovered-from' } }
					}
				]
			}),
			stored('3')
		]);
		answer(
			fromAi(2, {
				dependencies: [1],
				subtasks: [{ id: 1, title: 'Sub', status: 'pending', dependencies: ['3'] }]
			}),
			fromAi(3, { dependencies: [2] })
		);

		await update();

		const [, two, three] = savedTasks();
		expect(two.dependencies).toEqual(['1']);
		expect(two.metadata).toEqual({ taskLinks: { 1: 'related' } });
		expect(two.subtasks[0].metadata).toEqual({
			taskLinks: { 3: 'discovered-from' },
			dependencySources: { 3: 'inferred' }
		});
		expect(three.metadata).toEqual({ dependencySources: { 2: 'inferred' } });
	});

	it('warns about each sent task the AI did not return', async () => {
		answer(fromAi(2));
		const warnings: string[] = [];

		const result = await tmCore.tasks.updateFrom(
			{ from: 2, prompt: 'New direction' },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(result.updatedTasks.map((t) => t.id)).toEqual(['2']);
		expect(savedTasks()[2].title).toBe('Task 3');
		expect(warnings).toEqual([
			"The AI didn't return task 3, so it was left as it was"
		]);
	});

	it('keeps the status unless the prompt mentions it, and done subtasks', async () => {
		const done = { id: 1, title: 'Shipped', status: 'done', dependencies: [] };
		write([stored('2', { subtasks: [done] })]);
		answer(
			fromAi(2, {
				status: 'done',
				subtasks: [{ ...done, title: 'Shipped v2', status: 'pending' }]
			})
		);
		const warnings: string[] = [];

		await tmCore.tasks.updateFrom(
			{ from: 2, prompt: 'New direction' },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(savedTasks()[0].status).toBe('pending');
		expect(savedTasks()[0].subtasks).toMatchObject([done]);
		expect(warnings).toEqual([
			'Task 2: Completed subtask 1 was modified or removed. Restoring.',
			"Task 2: AI changed task status. Restoring original status 'pending'."
		]);
	});

	it('makes no AI call and changes nothing when no unfinished task is from the ID on', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const result = await update({ from: 4 });

		expect(result).toMatchObject({ sentCount: 0, updatedTasks: [] });
		expect(generateObject).not.toHaveBeenCalled();
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('leaves other tags as they were', async () => {
		write([stored('2')], {
			feature: { tasks: [stored('2', { title: 'Feature' })], metadata: {} }
		});
		answer(fromAi(2));

		await update();

		expect(readFile().feature.tasks[0].title).toBe('Feature');
		expect(savedTasks()[0].title).toBe('Task 2, revised');
	});

	it('works on the tag it is given', async () => {
		write([stored('2')], {
			feature: { tasks: [stored('2', { title: 'Feature' })], metadata: {} }
		});
		answer(fromAi(2));

		const result = await update({ tag: 'feature' });

		expect(result.tag).toBe('feature');
		expect(readFile().feature.tasks[0].title).toBe('Task 2, revised');
		expect(savedTasks()[0].title).toBe('Task 2');
	});

	it.each([
		[{ from: 'abc' }, '"abc" isn\'t a task ID'],
		[{ from: '0' }, '"0" isn\'t a task ID'],
		[{ prompt: ' ' }, 'Update prompt is required']
	])('refuses %o before any AI call', async (input, message) => {
		await expect(update(input)).rejects.toThrow(message);
		expect(generateObject).not.toHaveBeenCalled();
	});

	it('keeps changes made while the AI was writing, and skips a task removed meanwhile (#243)', async () => {
		const warnings: string[] = [];
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks = data.master.tasks.filter((t: any) => t.id !== '3');
			data.master.tasks[1].status = 'blocked';
			data.master.tasks.push(stored('5', { title: 'Added meanwhile' }));
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply([fromAi(2), fromAi(3)]) as any;
		});

		const result = await tmCore.tasks.updateFrom(
			{ from: 2, prompt: 'New direction' },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(savedTasks().map((t: any) => [t.id, t.title, t.status])).toEqual([
			['1', 'Task 1', 'pending'],
			['2', 'Task 2, revised', 'blocked'],
			['4', 'Task 4', 'done'],
			['5', 'Added meanwhile', 'pending']
		]);
		expect(result.updatedTasks.map((t) => t.id)).toEqual(['2']);
		expect(warnings).toContain('Task 3 was removed while it was being updated');
	});
});
