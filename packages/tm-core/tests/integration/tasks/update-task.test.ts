/**
 * @fileoverview tasks.updateWithPrompt (update-task) against a real
 * tasks.json. Only the AI call is mocked: what the rewrite keeps (stored
 * fields, ID, status, done subtasks, links, dependency marks), append mode,
 * metadata, the refusals made before any call, and the save that keeps
 * changes made while the AI was writing.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { resolveSubtaskDependency } from '../../../src/modules/dependencies/subtask-dependency.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const stored = (extra = {}) => ({
	id: '1',
	title: 'Original Task',
	description: 'Original description',
	status: 'pending',
	dependencies: [] as string[],
	priority: 'low',
	details: 'Stored details',
	testStrategy: 'Stored strategy',
	subtasks: [] as unknown[],
	...extra
});

const fromAi = (extra = {}) => ({
	id: 1,
	title: 'Updated Task',
	description: 'Updated description',
	status: 'pending',
	dependencies: [] as Array<string | number>,
	priority: 'high',
	details: 'New details',
	testStrategy: 'New tests',
	subtasks: [] as unknown[] | null,
	...extra
});

const sub = (id: number, extra = {}) => ({
	id,
	title: `S${id}`,
	status: 'pending',
	dependencies: [] as Array<string | number>,
	...extra
});

const reply = (mainResult: unknown) => ({
	mainResult,
	telemetryData: { totalTokens: 7 } as any,
	tagInfo: { currentTag: 'master', availableTags: ['master'] },
	providerName: 'claude-code',
	modelId: 'sonnet'
});

describe('tasks.updateWithPrompt', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;
	let generateText: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const saved = () => readFile().master.tasks[0];
	const write = (...tasks: unknown[]) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks, metadata: {} } })
		);
	const answer = (task: unknown) =>
		generateObject.mockResolvedValue(reply({ task }) as any);
	const update = (input = {}) =>
		tmCore.tasks.updateWithPrompt({ id: '1', prompt: 'Rewrite it', ...input });

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-task-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write(stored());
		generateObject = vi.spyOn(AiService.prototype, 'generateObject');
		answer(fromAi());
		generateText = vi
			.spyOn(AiService.prototype, 'generateText')
			.mockResolvedValue(reply('Keep the alias table.') as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('saves the rewrite with its usage, under the stored string ID', async () => {
		answer(fromAi({ dependencies: [2] }));
		write(stored(), stored({ id: '2', title: 'Two' }));

		const result = await update({ prompt: 'Use new requirements' });

		expect(saved()).toMatchObject({
			id: '1',
			title: 'Updated Task',
			priority: 'high',
			details: 'New details',
			dependencies: ['2']
		});
		expect(result.task.title).toBe('Updated Task');
		expect(result.telemetryData).toEqual({ totalTokens: 7 });
		expect(generateObject.mock.calls[0][0]).toMatchObject({
			role: 'main',
			commandName: 'update-task',
			objectName: 'task'
		});
		expect((generateObject.mock.calls[0][0] as any).prompt).toContain(
			'Use new requirements'
		);
	});

	it('keeps stored fields the AI leaves out or nulls (#283, #286)', async () => {
		const criteria = [{ text: 'Login works', checked: true }];
		const github = { issue: 12, url: 'https://github.com/o/r/issues/12' };
		write(
			stored({
				acceptanceCriteria: criteria,
				definitionOfDoneChecked: ['Tests pass'],
				github,
				tags: ['api'],
				assignee: 'kim',
				createdAt: '2026-01-01T00:00:00.000Z',
				subtasks: [
					sub(1, {
						assignee: 'lee',
						testStrategy: 'Sub strategy',
						acceptanceCriteria: [{ text: 'Sub works', checked: false }]
					})
				]
			})
		);
		answer(
			fromAi({
				priority: null,
				details: null,
				testStrategy: null,
				subtasks: [sub(1, { testStrategy: null })]
			})
		);

		await update();

		expect(saved()).toMatchObject({
			title: 'Updated Task',
			priority: 'low',
			details: 'Stored details',
			testStrategy: 'Stored strategy',
			acceptanceCriteria: criteria,
			definitionOfDoneChecked: ['Tests pass'],
			github,
			tags: ['api'],
			assignee: 'kim',
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		expect(saved().subtasks[0]).toMatchObject({
			assignee: 'lee',
			testStrategy: 'Sub strategy',
			acceptanceCriteria: [{ text: 'Sub works', checked: false }]
		});
	});

	it('marks dependencies the AI adds as inferred, keeping earlier marks and user metadata', async () => {
		write(
			stored({ id: '3' }),
			stored({ id: '4' }),
			stored({ id: '5' }),
			stored({
				id: '1',
				dependencies: ['3', '4'],
				metadata: { jira: 'ABC-1', dependencySources: { 3: 'inferred' } }
			})
		);
		answer(fromAi({ dependencies: [3, 4, 5] }));

		const { task } = await update();

		expect(task.metadata).toEqual({
			jira: 'ABC-1',
			dependencySources: { 3: 'inferred', 5: 'inferred' }
		});
	});

	it('drops the mark of a dependency the AI removed', async () => {
		write(
			stored({ id: '3' }),
			stored({
				dependencies: ['3'],
				metadata: { dependencySources: { 3: 'inferred' } }
			})
		);

		await update();

		expect(readFile().master.tasks[1]).not.toHaveProperty('metadata');
	});

	it('renumbers subtasks, keeps their marks and reads dependency forms as legacy did', async () => {
		write(
			stored({ id: '2' }),
			stored({
				id: '5',
				subtasks: [
					sub(1),
					sub(2, {
						dependencies: [1],
						metadata: { owner: 'kim', dependencySources: { '5.1': 'inferred' } }
					})
				]
			})
		);
		answer(
			fromAi({
				id: 9,
				subtasks: [
					sub(4),
					sub(7, { title: 'S2', dependencies: [1] }),
					// Sibling 1, task 2 (not sibling 2) and subtask 2.1
					sub(8, { title: 'S3', dependencies: [1, '2', '2.1'] })
				]
			})
		);

		const { task } = await update({ id: '5' });

		const [, second, third] = task.subtasks;
		expect(task.subtasks.map((s) => s.id)).toEqual(['1', '2', '3']);
		expect(second.metadata).toEqual({
			owner: 'kim',
			dependencySources: { '5.1': 'inferred' }
		});
		expect(third.dependencies).toEqual([1, '2', '2.1']);
		expect(
			third.dependencies.map((d) => resolveSubtaskDependency(5, d))
		).toEqual(['5.1', '2', '2.1']);
		expect(third.metadata?.dependencySources).toEqual({
			'5.1': 'inferred',
			'2': 'inferred',
			'2.1': 'inferred'
		});
		expect(readFile().master.tasks[1].id).toBe('5');
	});

	it('restores a done subtask the AI changed, and subtasks the AI dropped', async () => {
		const done = sub(1, { title: 'Shipped', status: 'done', details: 'kept' });
		write(stored({ subtasks: [done, sub(2)] }));
		answer(fromAi({ subtasks: [sub(1, { title: 'Shipped v2' }), sub(2)] }));
		const warnings: string[] = [];

		await update();
		const first = saved().subtasks;
		expect(first.find((s: any) => s.id === '1')).toMatchObject({
			title: 'Shipped',
			status: 'done',
			details: 'kept'
		});

		write(stored({ subtasks: [done] }));
		answer(fromAi({ subtasks: null }));
		await tmCore.tasks.updateWithPrompt(
			{ id: '1', prompt: 'Rewrite it' },
			{ onWarning: (m) => warnings.push(m) }
		);
		expect(saved().subtasks).toMatchObject([{ ...done, id: '1' }]);
		expect(warnings).toContain(
			'Subtasks removed by AI. Restoring original subtasks.'
		);
	});

	it('keeps the status unless the prompt mentions it', async () => {
		answer(fromAi({ status: 'done' }));
		const warnings: string[] = [];

		await tmCore.tasks.updateWithPrompt(
			{ id: '1', prompt: 'Rewrite it' },
			{ onWarning: (m) => warnings.push(m) }
		);
		expect(saved().status).toBe('pending');
		expect(warnings).toEqual([
			"AI changed task status. Restoring original status 'pending'."
		]);

		await update({ prompt: 'Set the status to in-progress' });
		expect(saved().status).toBe('done');
	});

	it('keeps related and discovered-from links, which --metadata cannot replace', async () => {
		const links = { 4: 'related', 6: 'discovered-from' };
		write(
			stored({
				metadata: { owner: 'sam', taskLinks: links },
				subtasks: [sub(1, { metadata: { taskLinks: { 4: 'related' } } })]
			})
		);
		answer(fromAi({ subtasks: [sub(1)] }));

		await update({ metadata: { sprint: 2, taskLinks: { 9: 'related' } } });

		expect(saved().metadata).toEqual({
			owner: 'sam',
			sprint: 2,
			taskLinks: links
		});
		expect(saved().subtasks[0].metadata).toEqual({
			taskLinks: { 4: 'related' }
		});
	});

	it('saves metadata alone without an AI call, ignoring the reserved keys', async () => {
		write(stored({ metadata: { owner: 'sam', taskLinks: { 4: 'related' } } }));

		const result = await update({
			prompt: '',
			metadata: {
				sprint: 2,
				taskLinks: {},
				dependencySources: { 9: 'inferred' }
			}
		});

		expect(generateObject).not.toHaveBeenCalled();
		expect(result.telemetryData).toBeNull();
		expect(saved().metadata).toEqual({
			owner: 'sam',
			sprint: 2,
			taskLinks: { 4: 'related' }
		});
	});

	it('appends the AI text to the details, timestamped, and stamps the description', async () => {
		const result = await update({ append: true, prompt: 'Note the aliases' });

		expect(generateObject).not.toHaveBeenCalled();
		expect(generateText.mock.calls[0][0]).toMatchObject({
			commandName: 'update-task'
		});
		expect(result.appended).toBe('Keep the alias table.');
		expect(saved().details).toMatch(
			/^Stored details\n<info added on (.+)>\nKeep the alias table\.\n<\/info added on \1>$/
		);
		expect(saved().description).toMatch(
			/^Original description \[Updated: .+\]$/
		);
		expect(saved().title).toBe('Original Task');
	});

	it('leaves the task as it was when the AI appends nothing', async () => {
		generateText.mockResolvedValue(reply('  ') as any);
		const before = saved();

		const result = await update({ append: true });

		expect(result.appended).toBe('');
		expect(saved()).toEqual(before);
	});

	it('skips a done task without an AI call', async () => {
		write(stored({ status: 'done' }));

		const result = await update();

		expect(result.skipped).toBe('done');
		expect(generateObject).not.toHaveBeenCalled();
		expect(saved().title).toBe('Original Task');
	});

	it('points a subtask ID at update-subtask', async () => {
		await expect(update({ id: '1.2' })).rejects.toMatchObject({
			hint: 'Update subtasks with `taskgraph update-subtask`'
		});
	});

	it.each([
		[{ id: '1.2' }, '"1.2" isn\'t a task ID'],
		[{ id: 'abc' }, '"abc" isn\'t a task ID'],
		[{ id: '9' }, 'Task 9 not found'],
		[{ prompt: '  ' }, 'Prompt cannot be empty unless metadata is provided']
	])('refuses %o before any AI call', async (input, message) => {
		await expect(update(input)).rejects.toThrow(message);
		expect(generateObject).not.toHaveBeenCalled();
	});

	it.each([
		[{ task: null }, 'Received invalid task object from AI'],
		[
			{ task: { id: 1, status: 'pending' } },
			'Updated task missing required fields'
		]
	])(
		'leaves the file as it was on a bad AI reply %#',
		async (mainResult, message) => {
			generateObject.mockResolvedValue(reply(mainResult) as any);
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(update()).rejects.toThrow(message);
			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		}
	);

	it('keeps a status set and a criterion checked while the AI was writing (#243)', async () => {
		write(stored({ acceptanceCriteria: [{ text: 'Works', checked: false }] }));
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].status = 'in-progress';
			data.master.tasks[0].acceptanceCriteria[0].checked = true;
			data.master.tasks.push(stored({ id: '2', title: 'Added meanwhile' }));
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply({ task: fromAi() }) as any;
		});

		await update();

		const [first, second] = readFile().master.tasks;
		expect(first).toMatchObject({
			title: 'Updated Task',
			status: 'in-progress',
			acceptanceCriteria: [{ text: 'Works', checked: true }]
		});
		expect(second.title).toBe('Added meanwhile');
	});

	it('warns when a field the AI rewrote was also changed during the call', async () => {
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].details = 'Edited meanwhile';
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply({ task: fromAi() }) as any;
		});
		const warnings: string[] = [];

		await tmCore.tasks.updateWithPrompt(
			{ id: '1', prompt: 'Rewrite it' },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(saved().details).toBe(fromAi().details);
		expect(warnings).toEqual([
			"The details of task 1 changed while the AI was writing; the AI's version was saved"
		]);
	});

	it('merges a change made during the call into the subtask the AI moved (#576)', async () => {
		const done = sub(1, { title: 'Shipped', status: 'done' });
		write(stored({ subtasks: [done, sub(2), sub(3)] }));
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].subtasks[1].status = 'in-progress';
			data.master.tasks[0].subtasks.push(sub(4, { title: 'Added meanwhile' }));
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			// The AI puts S3 first and renumbers by position itself
			return reply({
				task: fromAi({
					subtasks: [
						sub(1, { title: 'S3' }),
						{ ...done, id: 2 },
						sub(3, { title: 'S2' })
					]
				})
			}) as any;
		});

		await update();

		expect(saved().subtasks.map((s: any) => [s.id, s.title, s.status])).toEqual(
			[
				['1', 'S3', 'pending'],
				// Still after the subtask it followed
				['4', 'Added meanwhile', 'pending'],
				['2', 'Shipped', 'done'],
				['3', 'S2', 'in-progress']
			]
		);
	});

	it('matches by title and keeps the order when the AI inserts a subtask first and renumbers the rest (#576, #635)', async () => {
		write(
			stored({ subtasks: [sub(1, { title: 'A' }), sub(2, { title: 'B' })] })
		);
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].subtasks[0].status = 'in-progress';
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply({
				task: fromAi({
					subtasks: [
						sub(1, { title: 'New' }),
						sub(2, { title: 'A' }),
						sub(3, { title: 'B' })
					]
				})
			}) as any;
		});

		await update();

		expect(saved().subtasks.map((s: any) => [s.id, s.title, s.status])).toEqual(
			[
				['1', 'New', 'pending'],
				['2', 'A', 'in-progress'],
				['3', 'B', 'pending']
			]
		);
	});

	it('keeps an unchanged done subtask in place, without a warning', async () => {
		const done = {
			id: 1,
			title: 'Shipped',
			description: 'd',
			status: 'done',
			dependencies: [],
			details: 'kept',
			testStrategy: 't'
		};
		write(stored({ subtasks: [done, sub(2)] }));
		// The AI sends the same done subtask with its keys in another order
		const { testStrategy, details, ...rest } = done;
		answer(fromAi({ subtasks: [{ details, testStrategy, ...rest }, sub(2)] }));
		const warnings: string[] = [];

		await tmCore.tasks.updateWithPrompt(
			{ id: '1', prompt: 'Rewrite it' },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(saved().subtasks.map((s: any) => s.id)).toEqual(['1', '2']);
		expect(warnings).toEqual([]);
	});

	it('keeps subtasks added during the call when the AI sends null for a field the task lacked', async () => {
		const { subtasks: _none, ...noSubtasks } = stored();
		write(noSubtasks);
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].subtasks = [sub(1, { title: 'Added meanwhile' })];
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply({ task: fromAi({ subtasks: null }) }) as any;
		});

		await update();

		expect(saved().subtasks).toMatchObject([{ title: 'Added meanwhile' }]);
	});

	it('keeps a dependency added during the call when the AI keeps the list (number IDs)', async () => {
		write(
			stored({ id: 3, dependencies: [1] }),
			stored({ id: 1 }),
			stored({ id: 2 })
		);
		generateObject.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].dependencies = [1, 2];
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return reply({ task: fromAi({ id: 3, dependencies: [1] }) }) as any;
		});

		await update({ id: '3' });

		expect(saved().dependencies.map(String)).toEqual(['1', '2']);
	});

	it('fails without saving when the task was removed during the AI call', async () => {
		generateObject.mockImplementation(async () => {
			write(stored({ id: '2' }));
			return reply({ task: fromAi() }) as any;
		});

		await expect(update()).rejects.toThrow(
			'Task 1 was removed while it was being updated'
		);
		expect(readFile().master.tasks.map((t: any) => t.id)).toEqual(['2']);
	});
});
