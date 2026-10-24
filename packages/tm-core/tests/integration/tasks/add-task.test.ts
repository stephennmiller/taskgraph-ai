/**
 * @fileoverview tasks.add against a real tasks.json. Only the AI call is
 * mocked: dependencies, provenance, links, IDs (archive included), tags,
 * and the save that keeps changes made while the AI was writing.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: string | number, title: string, extra = {}) => ({
	id,
	title,
	description: title,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	subtasks: [],
	...extra
});

/** What the model answers; `dependencies` are its suggestions */
const aiTask = (extra: Record<string, unknown> = {}) => ({
	mainResult: {
		title: 'Task from the AI',
		description: 'Description from the AI',
		details: 'Details from the AI',
		testStrategy: 'Tests from the AI',
		dependencies: [],
		...extra
	},
	telemetryData: { totalTokens: 10 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] }
});

const spyOnAi = () => vi.spyOn(AiService.prototype, 'generateObject');

describe('tasks.add', () => {
	let projectDir: string;
	let tasksPath: string;
	let archivePath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof spyOnAi>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	const added = (tag = 'master') => readFile()[tag].tasks.at(-1);

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-add-task-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		archivePath = path.join(tgDir, 'tasks', 'archive.json');
		write({
			master: {
				tasks: [
					task(1, 'Task 1'),
					task(2, 'Task 2'),
					task(3, 'Task 3', {
						dependencies: [1],
						subtasks: [
							{ id: 2, title: 'Sub', status: 'pending', dependencies: [] }
						]
					})
				],
				metadata: {}
			},
			feature: {
				tasks: [task(1, 'Feature groundwork')],
				metadata: {}
			}
		});
		generateObject = spyOnAi().mockResolvedValue(aiTask() as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	describe('with the AI', () => {
		it('saves the task the AI wrote under the next ID, pending', async () => {
			const result = await tmCore.tasks.add({ prompt: 'Add login' });

			expect(result.task.id).toBe('4');
			expect(added()).toMatchObject({
				id: '4',
				title: 'Task from the AI',
				details: 'Details from the AI',
				status: 'pending',
				priority: 'medium',
				dependencies: []
			});
			expect(result.telemetryData).toEqual({ totalTokens: 10 });
			expect(result.tagInfo).toEqual({
				currentTag: 'master',
				availableTags: ['master']
			});
			const call = generateObject.mock.calls[0][0];
			expect(call).toMatchObject({
				role: 'main',
				commandName: 'add-task',
				objectName: 'newTaskData'
			});
			expect(call.prompt).toContain('Add login');
		});

		it('uses the research role with research', async () => {
			await tmCore.tasks.add({ prompt: 'Add login', research: true });

			expect(generateObject.mock.calls[0][0].role).toBe('research');
		});

		it('takes the object from mainResult.object too', async () => {
			generateObject.mockResolvedValueOnce({
				mainResult: { object: aiTask().mainResult },
				telemetryData: null
			} as any);

			await tmCore.tasks.add({ prompt: 'Add login' });

			expect(added().title).toBe('Task from the AI');
		});

		it('stores empty text, not null, when the AI leaves details out', async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ details: null, testStrategy: undefined }) as any
			);

			await tmCore.tasks.add({ prompt: 'Add login' });

			expect(added()).toMatchObject({ details: '', testStrategy: '' });
		});

		it('fails when the AI returns no task, and saves nothing', async () => {
			generateObject.mockResolvedValueOnce({ mainResult: {} } as any);
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(tmCore.tasks.add({ prompt: 'Add login' })).rejects.toThrow(
				'AI service did not return a valid task object.'
			);
			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		});

		it('passes an AI failure on and leaves the file as it was', async () => {
			generateObject.mockRejectedValueOnce(new Error('AI service failed'));
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(tmCore.tasks.add({ prompt: 'Add login' })).rejects.toThrow(
				'AI service failed'
			);
			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		});

		it('tells the caller which tasks the AI sees before it calls', async () => {
			const onAiCall = vi.fn();

			await tmCore.tasks.add(
				{ prompt: 'Task 2', dependencies: ['1'] },
				{ onAiCall }
			);

			const [{ dependencyIds, relatedTaskIds }] = onAiCall.mock.calls[0];
			expect(dependencyIds).toEqual(['1']);
			expect(relatedTaskIds).toContain('2');
			expect(relatedTaskIds).not.toContain('1');
		});
	});

	describe('without the AI', () => {
		it('saves a title and description as given, with no AI call', async () => {
			const result = await tmCore.tasks.add({
				title: 'Write the README',
				description: 'Setup and scripts',
				details: 'Details',
				prompt: 'ignored'
			});

			expect(generateObject).not.toHaveBeenCalled();
			expect(result.telemetryData).toBeNull();
			expect(result.tagInfo).toBeNull();
			expect(added()).toMatchObject({
				id: '4',
				title: 'Write the README',
				details: 'Details',
				testStrategy: ''
			});
		});

		it('refuses a call with neither a prompt nor a title and description', async () => {
			await expect(tmCore.tasks.add({ title: 'Only a title' })).rejects.toThrow(
				'Either the prompt parameter or both title and description parameters are required for adding a task'
			);
		});
	});

	describe('dependencies', () => {
		it('keeps the ones given that exist, as strings', async () => {
			await tmCore.tasks.add({ prompt: 'p', dependencies: [1, 2] });

			expect(added().dependencies).toEqual(['1', '2']);
			// Every dependency was passed in, so none is marked inferred
			expect(added()).not.toHaveProperty('metadata');
		});

		it('drops one that does not exist, with a warning', async () => {
			const onWarning = vi.fn();

			await tmCore.tasks.add(
				{ prompt: 'p', dependencies: [999] },
				{ onWarning }
			);

			expect(added().dependencies).toEqual([]);
			expect(onWarning).toHaveBeenCalledWith(
				"Task 999 doesn't exist; adding the task without that dependency"
			);
		});

		it('marks the ones the AI chose as inferred', async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ dependencies: [1, 2] }) as any
			);

			await tmCore.tasks.add({ prompt: 'p' });

			expect(added().metadata.dependencySources).toEqual({
				1: 'inferred',
				2: 'inferred'
			});
		});

		it('keeps the ones given explicit and adds the AI suggestions (#271)', async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ dependencies: [2, 3, 1] }) as any
			);

			const result = await tmCore.tasks.add({ prompt: 'p', dependencies: [1] });

			expect(added().dependencies).toEqual(['1', '2', '3']);
			expect(added().metadata.dependencySources).toEqual({
				2: 'inferred',
				3: 'inferred'
			});
			expect(result.dependencies).toEqual([
				{ id: '1', title: 'Task 1', addedByAi: false },
				{ id: '2', title: 'Task 2', addedByAi: true },
				{ id: '3', title: 'Task 3', addedByAi: true }
			]);
		});

		it('drops an AI suggestion that does not exist, with a warning', async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ dependencies: [2, 42] }) as any
			);
			const onWarning = vi.fn();

			await tmCore.tasks.add({ prompt: 'p' }, { onWarning });

			expect(added().dependencies).toEqual(['2']);
			expect(onWarning).toHaveBeenCalledWith(
				"The AI suggested dependencies that don't exist (42); left them out"
			);
		});

		it('reads 3.2 as that subtask, not task 3 (#290)', async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ dependencies: ['2'] }) as any
			);

			const result = await tmCore.tasks.add({
				prompt: 'p',
				dependencies: ['1', '3.2']
			});

			expect(added().dependencies).toEqual(['1', '3.2', '2']);
			expect(result.dependencies[1]).toMatchObject({ id: '3.2', title: 'Sub' });
		});

		it("resolves within the target tag only (#288)", async () => {
			generateObject.mockResolvedValueOnce(
				aiTask({ dependencies: [1, 3] }) as any
			);
			const onWarning = vi.fn();

			const result = await tmCore.tasks.add(
				{ prompt: 'p', dependencies: [3], tag: 'feature' },
				{ onWarning }
			);

			expect(added('feature').dependencies).toEqual(['1']);
			expect(onWarning).toHaveBeenCalledWith(
				"Task 3 doesn't exist; adding the task without that dependency"
			);
			expect(result.dependencies).toEqual([
				{ id: '1', title: 'Feature groundwork', addedByAi: true }
			]);
		});
	});

	describe('fields', () => {
		it('stores acceptance criteria unchecked, without blank ones', async () => {
			await tmCore.tasks.add({
				prompt: 'p',
				acceptanceCriteria: ['Login works', '  ', 'Tokens expire']
			});

			expect(added().acceptanceCriteria).toEqual([
				{ text: 'Login works', checked: false },
				{ text: 'Tokens expire', checked: false }
			]);
		});

		it('uses the priority given, and medium with a warning for an unknown one', async () => {
			await tmCore.tasks.add({ prompt: 'p', priority: 'HIGH' });
			expect(added().priority).toBe('high');

			const onWarning = vi.fn();
			await tmCore.tasks.add({ prompt: 'p', priority: 'urgent' }, { onWarning });
			expect(added().priority).toBe('medium');
			expect(onWarning).toHaveBeenCalledWith(
				'Invalid priority "urgent". Using default priority "medium".'
			);
		});

		it('uses global.defaultPriority without a priority, and warns when it is unknown', async () => {
			const configPath = path.join(projectDir, '.taskgraph', 'config.json');
			const withDefault = async (defaultPriority: string) => {
				fs.writeFileSync(
					configPath,
					JSON.stringify({ models: {}, global: { defaultPriority } })
				);
				const core = await createTmCore({ projectPath: projectDir });
				const onWarning = vi.fn();
				const result = await core.tasks.add(
					{ title: 'A', description: 'd' },
					{ onWarning }
				);
				await core.close();
				return { priority: result.task.priority, onWarning };
			};

			expect((await withDefault('High')).priority).toBe('high');
			const unknown = await withDefault('urgent');
			expect(unknown.priority).toBe('medium');
			expect(unknown.onWarning).toHaveBeenCalledWith(
				'global.defaultPriority "urgent" isn\'t high, medium or low. Using "medium".'
			);
		});

		it('passes on the AI config warnings, such as an unsupported provider', async () => {
			fs.writeFileSync(
				path.join(projectDir, '.taskgraph', 'config.json'),
				JSON.stringify({
					models: { main: { provider: 'openai', modelId: 'gpt' } },
					global: {}
				})
			);
			const core = await createTmCore({ projectPath: projectDir });
			const onWarning = vi.fn();

			await core.tasks.add({ prompt: 'p' }, { onWarning });

			expect(onWarning).toHaveBeenCalledWith(
				expect.stringContaining('main provider "openai" isn\'t supported')
			);
			await core.close();
		});

		it('stores discoveredFrom as a link that never blocks', async () => {
			const result = await tmCore.tasks.add({
				title: 'Fix the flaky test',
				description: 'Found it',
				discoveredFrom: '3.2'
			});

			expect(added().dependencies).toEqual([]);
			expect(added().metadata).toEqual({
				taskLinks: { '3.2': 'discovered-from' }
			});
			expect(result.discoveredFrom).toEqual({ id: '3.2', title: 'Sub' });
		});

		it('refuses an unknown discoveredFrom before any AI call or write', async () => {
			const before = fs.readFileSync(tasksPath, 'utf8');

			await expect(
				tmCore.tasks.add({ prompt: 'p', discoveredFrom: '42' })
			).rejects.toMatchObject({
				message: "Task 42 doesn't exist",
				hint: 'Run `taskgraph list` to see task IDs'
			});
			await expect(
				tmCore.tasks.add({ prompt: 'p', discoveredFrom: 'abc' })
			).rejects.toThrow('"abc" isn\'t a task ID');
			expect(generateObject).not.toHaveBeenCalled();
			expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		});
	});

	describe('IDs and the file', () => {
		it('keeps a task added while the AI call runs and picks a free ID', async () => {
			generateObject.mockImplementationOnce(async () => {
				// Another process adds task 4 and finishes task 1 meanwhile
				const current = readFile();
				current.master.tasks[0].status = 'done';
				current.master.tasks.push(task('4', 'Added meanwhile'));
				write(current);
				return aiTask() as any;
			});

			const result = await tmCore.tasks.add({ prompt: 'p' });

			const saved = readFile();
			expect(saved.master.tasks.map((t: any) => [String(t.id), t.title])).toEqual(
				[
					['1', 'Task 1'],
					['2', 'Task 2'],
					['3', 'Task 3'],
					['4', 'Added meanwhile'],
					['5', 'Task from the AI']
				]
			);
			expect(saved.master.tasks[0].status).toBe('done');
			expect(result.task.id).toBe('5');
			expect(saved.feature.tasks).toHaveLength(1);
		});

		it('fails, writing nothing, when the tag is deleted during the AI call', async () => {
			generateObject.mockImplementationOnce(async () => {
				const current = readFile();
				delete current.feature;
				write(current);
				return aiTask() as any;
			});

			await expect(
				tmCore.tasks.add({ prompt: 'p', tag: 'feature' })
			).rejects.toThrow('Tag "feature" no longer exists');

			expect(readFile().feature).toBeUndefined();
			expect(readFile().master.tasks).toHaveLength(3);
		});

		it('creates the file when there is none', async () => {
			fs.rmSync(tasksPath);

			const result = await tmCore.tasks.add({ prompt: 'p' });

			expect(result.task.id).toBe('1');
			expect(readFile().master.tasks.map((t: any) => t.title)).toEqual([
				'Task from the AI'
			]);
		});

		it('numbers a task above the archived IDs, even ones restored since', async () => {
			fs.writeFileSync(
				archivePath,
				JSON.stringify({ master: { tasks: [], metadata: { highestId: 7 } } })
			);

			const result = await tmCore.tasks.add({ prompt: 'p' });

			expect(result.task.id).toBe('8');
		});
	});

	describe('tags', () => {
		it('adds to the tag given and leaves the others alone', async () => {
			await tmCore.tasks.add({ title: 'API work', description: 'd', tag: 'feature' });

			const saved = readFile();
			expect(saved.feature.tasks.map((t: any) => t.title)).toEqual([
				'Feature groundwork',
				'API work'
			]);
			expect(saved.master.tasks).toHaveLength(3);
		});

		it('adds to the active tag when none is given', async () => {
			fs.writeFileSync(
				path.join(projectDir, '.taskgraph', 'state.json'),
				JSON.stringify({ currentTag: 'feature' })
			);
			const core = await createTmCore({ projectPath: projectDir });

			const result = await core.tasks.add({ title: 'Auto', description: 'd' });

			expect(result.tag).toBe('feature');
			expect(readFile().feature.tasks).toHaveLength(2);
			expect(readFile().master.tasks).toHaveLength(3);
			await core.close();
		});

		it('refuses a tag that does not exist', async () => {
			await expect(
				tmCore.tasks.add({ title: 'A', description: 'd', tag: 'nope' })
			).rejects.toThrow('Tag "nope" not found.');
		});

		it.each(['tag', '_rawTaggedData'])(
			'keeps a tag named %s when adding to master (#399)',
			async (name) => {
				const data = readFile();
				data[name] = { tasks: [task('1', 'Kept task')], metadata: {} };
				write(data);

				await tmCore.tasks.add({ title: 'New', description: 'd' });

				expect(readFile()[name].tasks[0].title).toBe('Kept task');
				expect(readFile().master.tasks).toHaveLength(4);
			}
		);
	});
});
