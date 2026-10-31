/**
 * @fileoverview expand, update-task and update --from against a real
 * tasks.json, with the AI call mocked: a dependency the AI writes for a
 * subtask that would loop back to the subtask's own parent is dropped (#824),
 * and so is any other the AI writes for the task or a subtask it keeps that
 * would close a loop (#832). A parent can't finish before its subtasks, so
 * such a subtask could never start.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: string, dependencies: string[] = [], subtasks = []) => ({
	id,
	title: `Task ${id}`,
	description: `Task ${id} description`,
	status: 'pending',
	dependencies,
	priority: 'medium',
	details: '',
	testStrategy: '',
	subtasks
});

const aiSubtask = (id: number, dependencies: Array<string | number>) => ({
	id,
	title: `Step ${id}`,
	description: `Step ${id} description`,
	status: 'pending',
	dependencies,
	details: 'd',
	testStrategy: 't'
});

const reply = (mainResult: unknown) => ({
	mainResult,
	telemetryData: null,
	tagInfo: { currentTag: 'master', availableTags: ['master'] }
});

describe('AI-written subtask dependencies that loop through the parent', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const write = (...tasks: unknown[]) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({ master: { tasks, metadata: {} } })
		);
	const savedTask = (id: string) =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks.find(
			(t: { id: string }) => t.id === id
		);

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-subtask-loops-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		generateObject = vi.spyOn(AiService.prototype, 'generateObject');
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('expand drops a dependency on a task that waits on the parent', async () => {
		// Task 3 waits on 4, so a subtask of 4 can't wait on 3; 1 is fine
		write(task('1'), task('3', ['1', '4']), task('4'));
		generateObject.mockResolvedValue(
			reply({ subtasks: [aiSubtask(1, ['3', '1'])] }) as any
		);

		await tmCore.tasks.expand({ id: '4', num: 1 });

		expect(savedTask('4').subtasks[0].dependencies).toEqual(['1']);
	});

	it('expand-all checks each save against the subtasks saved before it', async () => {
		// Task 1 waits on 4 and 2 on 3: 3.1 → 1 and 4.1 → 2 are each fine
		// alone, but together they loop 3 → 3.1 → 1 → 4 → 4.1 → 2 → 3
		write(
			{ ...task('1', ['4']), status: 'done' },
			{ ...task('2', ['3']), status: 'done' },
			task('3'),
			task('4')
		);
		generateObject.mockResolvedValue(
			reply({ subtasks: [aiSubtask(1, ['1', '2'])] }) as any
		);

		await tmCore.tasks.expandAll({ num: 1 });

		const kept = ['3', '4'].flatMap(
			(id) => savedTask(id).subtasks[0].dependencies
		);
		expect(kept).toHaveLength(1);
	});

	/** Task 1 rewritten by `via`; `during` runs while the AI is writing */
	const rewrite = (via: string, aiTask: object, during = () => {}) => {
		const updateTask = via === 'update-task';
		generateObject.mockImplementation(async () => {
			during();
			return reply(updateTask ? { task: aiTask } : { tasks: [aiTask] }) as any;
		});
		const input = { prompt: 'Rewrite it' };
		return updateTask
			? tmCore.tasks.updateWithPrompt({ ...input, id: '1' })
			: tmCore.tasks.updateFrom({ ...input, from: 1 });
	};

	it.each(['update-task', 'update --from'])(
		'%s drops a dependency on a task that waits on the parent',
		async (via) => {
			// Task 2 waits on 1, so a subtask of 1 can't wait on 2; 3 is fine
			write(
				task('1', [], [aiSubtask(1, [])] as never),
				task('2', ['1']),
				task('3')
			);

			await rewrite(via, {
				...task('1'),
				subtasks: [aiSubtask(1, ['2', '3'])]
			});

			expect(savedTask('1').subtasks[0].dependencies).toEqual(['3']);
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s drops a task dependency that loops back to it (#832)',
		async (via) => {
			// Task 2 waits on 1, so 1 can't wait on 2; 3 is fine
			write(task('1'), task('2', ['1']), task('3'));

			await rewrite(via, task('1', ['2', '3']));

			expect(savedTask('1')).toMatchObject({
				dependencies: ['3'],
				metadata: { dependencySources: { '3': 'inferred' } }
			});
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s drops a dependency of a kept subtask on a task that waits on it (#832)',
		async (via) => {
			// Task 2 waits on 1.2, so 1.2 can't wait on 2; 3 is fine
			write(
				task('1', [], [aiSubtask(1, []), aiSubtask(2, [])] as never),
				task('2', ['1.2']),
				task('3')
			);

			await rewrite(via, {
				...task('1'),
				subtasks: [aiSubtask(1, []), aiSubtask(2, ['2', '3'])]
			});

			expect(savedTask('1').subtasks[1].dependencies).toEqual(['3']);
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s checks for loops against tasks.json as saved, not as read before the AI call (#832)',
		async (via) => {
			write(task('1', [], [aiSubtask(1, [])] as never), task('2'), task('3'));

			// Task 2 starts waiting on 1 while the AI is writing
			await rewrite(
				via,
				{ ...task('1', ['2']), subtasks: [aiSubtask(1, ['2', '3'])] },
				() => {
					const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
					data.master.tasks[1].dependencies = ['1'];
					fs.writeFileSync(tasksPath, JSON.stringify(data));
				}
			);

			expect(savedTask('1')).toMatchObject({
				dependencies: [],
				subtasks: [{ dependencies: ['3'] }]
			});
		}
	);
});
