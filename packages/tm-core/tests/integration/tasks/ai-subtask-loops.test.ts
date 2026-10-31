/**
 * @fileoverview expand, update-task and update --from against a real
 * tasks.json, with the AI call mocked: a dependency the AI writes for a
 * subtask that would loop back to the subtask's own parent is dropped (#824),
 * and so is any other the AI writes for the task or a subtask it keeps that
 * would close a loop (#832). A parent can't finish before its subtasks, so
 * such a subtask could never start. Each drop is a warning, and so is a
 * subtask a rewrite removes, with the dependencies on it (#863).
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

		const warnings: string[] = [];
		await tmCore.tasks.expand(
			{ id: '4', num: 1 },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(savedTask('4').subtasks[0].dependencies).toEqual(['1']);
		expect(warnings).toContain(
			'Dropped dependency 3 of subtask 4.1: it made a loop'
		);
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

	/**
	 * Task 1 rewritten by `via`; `during` runs while the AI is writing.
	 * Resolves to the warnings
	 */
	const rewrite = async (via: string, aiTask: object, during = () => {}) => {
		const updateTask = via === 'update-task';
		generateObject.mockImplementation(async () => {
			during();
			return reply(updateTask ? { task: aiTask } : { tasks: [aiTask] }) as any;
		});
		const input = { prompt: 'Rewrite it' };
		const warnings: string[] = [];
		const hooks = { onWarning: (m: string) => warnings.push(m) };
		await (updateTask
			? tmCore.tasks.updateWithPrompt({ ...input, id: '1' }, hooks)
			: tmCore.tasks.updateFrom({ ...input, from: 1 }, hooks));
		return warnings;
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

			const warnings = await rewrite(via, task('1', ['2', '3']));

			expect(savedTask('1')).toMatchObject({
				dependencies: ['3'],
				metadata: { dependencySources: { '3': 'inferred' } }
			});
			// Not just in debug output (#863)
			expect(warnings).toContain(
				'Dropped dependency 2 of task 1: it made a loop'
			);
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

	it.each(['update-task', 'update --from'])(
		'%s keeps a new dependency that loops only through one it drops (#832)',
		async (via) => {
			// 1.2 → 2 loops on its own (2 waits on 1.2). 1.1 → 3 is fine without
			// it, though 3 → 1.2 → 2 → 1.1 would loop with it
			write(
				task('1', [], [aiSubtask(1, []), aiSubtask(2, [])] as never),
				task('2', ['1.1', '1.2']),
				task('3', ['1.2'])
			);

			await rewrite(via, {
				...task('1'),
				subtasks: [aiSubtask(1, ['3']), aiSubtask(2, ['2'])]
			});

			expect(savedTask('1').subtasks.map((st: any) => st.dependencies)).toEqual(
				[['3'], []]
			);
		}
	);

	it('update --from drops one of two new dependencies of different tasks that loop together (#832)', async () => {
		write(task('1'), task('2'));
		generateObject.mockResolvedValue(
			reply({ tasks: [task('1', ['2']), task('2', ['1'])] }) as any
		);

		await tmCore.tasks.updateFrom({ prompt: 'Rewrite them', from: 1 });

		// The first task's is checked first, so it stays
		expect(savedTask('1').dependencies).toEqual(['2']);
		expect(savedTask('2')).toMatchObject({ dependencies: [] });
		expect(savedTask('2').metadata).toBeUndefined();
	});

	/** A pending subtask of task 1 as stored */
	const stored = (id: string, title: string) => ({
		...aiSubtask(1, []),
		id,
		title
	});

	it.each(['update-task', 'update --from'])(
		'%s matches nothing by ID when the AI renumbers gapped subtasks, and warns what it removed (#863)',
		async (via) => {
			write(
				task('1', [], [
					stored('1', 'A'),
					stored('3', 'C'),
					stored('4', 'D')
				] as never),
				task('2', ['1.4']),
				task('3', ['1.3'])
			);
			const retitled = (id: number, title: string) => ({
				...aiSubtask(id, []),
				title
			});

			const warnings = await rewrite(via, {
				...task('1'),
				subtasks: [
					retitled(1, 'A v2'),
					retitled(2, 'C v2'),
					retitled(3, 'D v2')
				]
			});

			// 3 is not C's rewrite: no stored subtask is paired with the wrong one
			expect(
				savedTask('1').subtasks.map((st: any) => [st.id, st.title])
			).toEqual([
				['5', 'A v2'],
				['6', 'C v2'],
				['7', 'D v2']
			]);
			expect(savedTask('3').dependencies).toEqual([]);
			expect(warnings).toContain(
				"Subtasks 1.1, 1.3, 1.4 aren't in the AI's rewrite, so they were removed; dependencies on them were dropped from 2, 3"
			);
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s still matches by title when the AI renumbers gapped subtasks (#863)',
		async (via) => {
			write(
				task('1', [], [stored('1', 'A'), stored('3', 'C')] as never),
				task('2', ['1.3'])
			);

			const warnings = await rewrite(via, {
				...task('1'),
				subtasks: [
					{ ...aiSubtask(1, []), title: 'A' },
					{ ...aiSubtask(2, []), title: 'C' }
				]
			});

			expect(savedTask('1').subtasks.map((st: any) => st.id)).toEqual([
				'1',
				'3'
			]);
			expect(savedTask('2').dependencies).toEqual(['1.3']);
			expect(warnings.join('\n')).not.toContain('removed');
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s keeps the IDs of a retitled reply that only drops a gapped subtask (#863)',
		async (via) => {
			write(
				task('1', [], [
					stored('1', 'A'),
					stored('2', 'B'),
					stored('4', 'D')
				] as never),
				task('2', ['1.2'])
			);

			// 1 and 2 are IDs the stored subtasks have: kept, as the prompt asks
			await rewrite(via, {
				...task('1'),
				subtasks: [
					{ ...aiSubtask(1, []), title: 'A v2' },
					{ ...aiSubtask(2, []), title: 'B v2' }
				]
			});

			expect(
				savedTask('1').subtasks.map((st: any) => [st.id, st.title])
			).toEqual([
				['1', 'A v2'],
				['2', 'B v2']
			]);
			expect(savedTask('2').dependencies).toEqual(['1.2']);
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s keeps the IDs of a retitled reply that sorts stored IDs without gaps and adds one (#863)',
		async (via) => {
			// 4 was inserted after 1 earlier: out of order, but no gaps
			write(
				task('1', [], [
					stored('1', 'A'),
					stored('4', 'N'),
					stored('2', 'B'),
					stored('3', 'C')
				] as never),
				task('2', ['1.2', '1.4'])
			);

			const warnings = await rewrite(via, {
				...task('1'),
				subtasks: [
					{ ...aiSubtask(1, []), title: 'A v2' },
					{ ...aiSubtask(2, []), title: 'B v2' },
					{ ...aiSubtask(3, []), title: 'C v2' },
					{ ...aiSubtask(4, []), title: 'N v2' },
					{ ...aiSubtask(5, []), title: 'New' }
				]
			});

			expect(
				savedTask('1').subtasks.map((st: any) => [st.id, st.title])
			).toEqual([
				['1', 'A v2'],
				['2', 'B v2'],
				['3', 'C v2'],
				['4', 'N v2'],
				['5', 'New']
			]);
			expect(savedTask('2').dependencies).toEqual(['1.2', '1.4']);
			expect(warnings.join('\n')).not.toContain('removed');
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s warns about a subtask the AI left out and the dependency that went with it (#863)',
		async (via) => {
			write(
				task('1', [], [
					aiSubtask(1, []),
					aiSubtask(2, []),
					aiSubtask(3, [])
				] as never),
				task('2', ['1.3'])
			);

			const warnings = await rewrite(via, {
				...task('1'),
				subtasks: [aiSubtask(1, []), aiSubtask(2, [])]
			});

			expect(savedTask('1').subtasks.map((st: any) => st.id)).toEqual([
				'1',
				'2'
			]);
			expect(savedTask('2').dependencies).toEqual([]);
			expect(warnings).toContain(
				"Subtask 1.3 isn't in the AI's rewrite, so it was removed; dependencies on it were dropped from 2"
			);
		}
	);

	it.each(['update-task', 'update --from'])(
		'%s keeps the subtasks when the AI returns none (#863)',
		async (via) => {
			write(
				task('1', [], [aiSubtask(1, []), aiSubtask(2, [])] as never),
				task('2', ['1.2'])
			);

			await rewrite(via, { ...task('1'), subtasks: [] });

			expect(savedTask('1').subtasks.map((st: any) => st.id)).toEqual([
				'1',
				'2'
			]);
			expect(savedTask('2').dependencies).toEqual(['1.2']);
		}
	);
});
