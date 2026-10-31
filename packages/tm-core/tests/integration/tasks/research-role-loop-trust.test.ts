/**
 * @fileoverview Every command that saves AI output withdraws loop approval
 * when the research role answered, whether asked for with --research or
 * reached as a fallback, and keeps it when another role answered. Only the
 * AI call is mocked; the reply's `role` says which role answered.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import {
	isLoopTrusted,
	trustLoop
} from '../../../src/modules/loop/loop-trust.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (id: string, title: string, extra = {}) => ({
	id,
	title,
	description: `${title} description`,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	details: `${title} details`,
	testStrategy: 'unit tests',
	subtasks: [],
	...extra
});

const subtask = (n: number) => ({
	id: n,
	title: `Step ${n}`,
	description: `Do step ${n}`,
	details: `How to do step ${n}`,
	dependencies: [],
	testStrategy: 'unit tests'
});

/** A reply each command accepts, keyed by the objectName it asks for */
const objects: Record<string, unknown> = {
	task: { task: task('1', 'Rewritten') },
	tasks: { tasks: [task('1', 'Rewritten')] },
	subtasks: { subtasks: [subtask(1), subtask(2)] },
	newTaskData: {
		task: {
			title: 'New task',
			description: 'New description',
			details: 'New details',
			testStrategy: 'unit tests',
			dependencies: []
		}
	},
	updated_task: { title: 'Scoped', description: 'Scoped description' },
	complexityAnalysis: {
		complexityAnalysis: [
			{
				taskId: 1,
				taskTitle: 'Login',
				complexityScore: 5,
				recommendedSubtasks: 3,
				expansionPrompt: 'Break it down',
				reasoning: 'Medium'
			}
		]
	}
};

const commands: Array<[string, (core: TmCore) => Promise<unknown>]> = [
	[
		'update-task',
		(core) => core.tasks.updateWithPrompt({ id: '1', prompt: 'p' })
	],
	[
		'update-task --append',
		(core) =>
			core.tasks.updateWithPrompt({ id: '1', prompt: 'p', append: true })
	],
	['update --from', (core) => core.tasks.updateFrom({ from: 1, prompt: 'p' })],
	['expand', (core) => core.tasks.expand({ id: '1', num: 2 })],
	['add-task', (core) => core.tasks.add({ prompt: 'Add login' })],
	[
		'update-subtask',
		(core) => core.tasks.updateSubtask({ id: '2.1', prompt: 'p' })
	],
	['scope-up', (core) => core.tasks.scope({ ids: '1', direction: 'up' })],
	['analyze-complexity', (core) => core.tasks.analyzeComplexity({})]
];

describe('loop approval after a command saves AI output', () => {
	let projectDir: string;
	let home: string;
	let tmCore: TmCore;
	let answeredBy: string;

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-research-trust-'))
		);
		// The loop trust file lives under HOME
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-research-trust-home-'));
		vi.stubEnv('HOME', home);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		fs.writeFileSync(
			path.join(tgDir, 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [
						task('1', 'Login'),
						task('2', 'Sessions', {
							subtasks: [{ ...subtask(1), status: 'pending' }]
						})
					],
					metadata: {}
				}
			})
		);
		const reply = (mainResult: unknown) => ({
			mainResult,
			telemetryData: null,
			tagInfo: { currentTag: 'master', availableTags: ['master'] },
			providerName: 'claude-code',
			modelId: 'sonnet',
			role: answeredBy
		});
		vi.spyOn(AiService.prototype, 'generateObject').mockImplementation(
			async (params) => reply(objects[params.objectName as string])
		);
		vi.spyOn(AiService.prototype, 'generateText').mockImplementation(async () =>
			reply('Added text')
		);
		tmCore = await createTmCore({ projectPath: projectDir });
		trustLoop(projectDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		await tmCore.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it.each(commands)(
		'%s withdraws it when the research role answered',
		async (_name, run) => {
			answeredBy = 'research';

			await run(tmCore);

			expect(isLoopTrusted(projectDir)).toBe(false);
		}
	);

	it.each(commands)(
		'%s keeps it when the main role answered',
		async (_name, run) => {
			answeredBy = 'main';

			await run(tmCore);

			expect(isLoopTrusted(projectDir)).toBe(true);
		}
	);
});
