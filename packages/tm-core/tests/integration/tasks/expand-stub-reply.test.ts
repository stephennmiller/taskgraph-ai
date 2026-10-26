/**
 * @fileoverview tasks.expand against a stub AI reply (#721): one subtask
 * where several were asked for, or placeholder text, is asked for again
 * once and never saved. Only the AI call is mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: string, subtasks: unknown[] = []) => ({
	id,
	title: `Task ${id}`,
	description: `Task ${id} description`,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	details: `Task ${id} details`,
	testStrategy: 'unit tests',
	subtasks
});

const aiSubtask = (id: number, extra = {}) => ({
	id,
	title: `Step ${id}`,
	description: `Step ${id} description`,
	dependencies: [] as number[],
	details: 'd',
	testStrategy: 't',
	...extra
});

const usage = (inputTokens: number) => ({
	userId: 'u',
	modelUsed: 'sonnet',
	providerName: 'claude-code',
	inputTokens,
	outputTokens: 1,
	totalCost: 0.1,
	currency: 'USD'
});

const answer = (subtasks: unknown[], inputTokens = 1) => ({
	mainResult: { subtasks },
	telemetryData: usage(inputTokens),
	tagInfo: null
});

describe('tasks.expand with a stub reply', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateObject: ReturnType<typeof vi.spyOn>;

	const saved = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-stub-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: { enableCodebaseAnalysis: false } })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		const kept = [aiSubtask(1), aiSubtask(2)].map((s) => ({
			...s,
			status: 'pending'
		}));
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: [task('1', kept), task('2'), task('3')], metadata: {} }
			})
		);
		generateObject = vi.spyOn(AiService.prototype, 'generateObject');
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('asks again when the AI returns one subtask for several, and saves the retry', async () => {
		const warnings: string[] = [];
		generateObject
			.mockResolvedValueOnce(answer([aiSubtask(1)], 5) as any)
			.mockResolvedValueOnce(
				answer([aiSubtask(1), aiSubtask(2), aiSubtask(3)], 7) as any
			);

		const result = await tmCore.tasks.expand(
			{ id: '2', num: 3 },
			{ onWarning: (m) => warnings.push(m) }
		);

		expect(generateObject).toHaveBeenCalledTimes(2);
		expect(warnings).toContain(
			'Task 2: the AI returned 1 subtask where 3 were asked for; asking again'
		);
		expect(saved()[1].subtasks).toHaveLength(3);
		expect(result.telemetryData).toMatchObject({
			inputTokens: 12,
			totalCost: 0.2
		});
	});

	it.each([
		['one-subtask', [aiSubtask(1)], '1 subtask where 3'],
		[
			'placeholder-description',
			[
				aiSubtask(1),
				aiSubtask(2, { description: 'To be determined.' }),
				aiSubtask(3)
			],
			'placeholder text in subtask 2'
		],
		[
			'placeholder-details',
			[aiSubtask(1), aiSubtask(2), aiSubtask(3, { details: '[TBD]' })],
			'placeholder text in subtask 3'
		]
	])(
		'fails on two %s replies in a row and keeps the subtasks',
		async (_name, subtasks, reason) => {
			generateObject.mockResolvedValue(answer(subtasks) as any);

			await expect(
				tmCore.tasks.expand({ id: '1', num: 3, force: true })
			).rejects.toThrow(reason);
			expect(generateObject).toHaveBeenCalledTimes(2);
			expect(saved()[0].subtasks).toHaveLength(2);
		}
	);

	it('takes one subtask when one was asked for, or the AI chose the count', async () => {
		generateObject.mockResolvedValue(answer([aiSubtask(1)]) as any);

		await tmCore.tasks.expand({ id: '2', num: 1 });
		await tmCore.tasks.expand({ id: '3', num: 0 });

		expect(generateObject).toHaveBeenCalledTimes(2);
		expect(saved()[1].subtasks).toHaveLength(1);
		expect(saved()[2].subtasks).toHaveLength(1);
	});
});
