/**
 * @fileoverview The prompts tasks.updateWithPrompt (update-task) and
 * tasks.updateFrom (update --from) send, against the ones the legacy
 * update-task-by-id.js and update-tasks.js sent on the same tasks.json
 * (captured in __snapshots__/update-prompt-inputs.legacy.json). Only the AI
 * call is mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { getPromptManager } from '../../../src/modules/ai/prompts/prompt-manager.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import legacyInputs from './__snapshots__/update-prompt-inputs.legacy.json' with {
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
				sub(1, 'Parse flags', { status: 'done' }),
				sub(2, 'Parse commands', { dependencies: [1] })
			]
		}),
		task(id(3), 'Add user authentication', { dependencies: [id(1), id(2)] }),
		task(id(4), 'Database schema for users', { details: '' }),
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

const aiTask = (id: unknown) => ({
	id: Number(id),
	title: 'T',
	description: 'D',
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	details: 'd',
	testStrategy: 't',
	subtasks: null
});

interface Scenario {
	id?: string;
	from?: number;
	prompt: string;
	research?: boolean;
	append?: boolean;
	stringIds?: boolean;
	tag?: string;
}

describe('update prompt inputs', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let ai: {
		object: ReturnType<typeof vi.spyOn>;
		text: ReturnType<typeof vi.spyOn>;
	};

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-prompt-'))
		);
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global: { enableCodebaseAnalysis: true } })
		);
		ai = {
			object: vi
				.spyOn(AiService.prototype, 'generateObject')
				.mockImplementation(async (params: any) => ({
					mainResult:
						params.objectName === 'task'
							? { task: aiTask(3) }
							: { tasks: [aiTask(3)] },
					telemetryData: null,
					tagInfo: { currentTag: 'master', availableTags: ['master'] },
					providerName: 'claude-code',
					modelId: 'sonnet',
					role: 'main'
				})),
			text: vi.spyOn(AiService.prototype, 'generateText').mockResolvedValue({
				mainResult: 'Added text',
				telemetryData: null,
				tagInfo: { currentTag: 'master', availableTags: ['master'] },
				providerName: 'claude-code',
				modelId: 'sonnet',
				role: 'main'
			})
		};
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	/** What the call sent, in the shape the legacy capture recorded */
	async function capture(s: Scenario, promptName: string, run: () => unknown) {
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(fixture(s.stringIds))
		);
		const loadPrompt = vi.spyOn(getPromptManager(), 'loadPrompt');
		await run();
		const [, { task: one, tasks, ...vars }, variant] =
			loadPrompt.mock.calls.find((c) => c[0] === promptName) as any;
		const kind = ai.text.mock.calls.length ? 'text' : 'object';
		const call = (kind === 'text' ? ai.text : ai.object).mock
			.calls[0][0] as any;
		const strip = (value: unknown) =>
			JSON.parse(JSON.stringify(value).split(projectDir).join('<root>'));
		return strip({
			vars,
			promptTasks: (tasks ?? [one]).map((t: unknown) => JSON.stringify(t)),
			variant: variant ?? null,
			kind,
			role: call.role,
			commandName: call.commandName,
			objectName: call.objectName ?? null,
			system: call.systemPrompt,
			prompt: call.prompt
		});
	}

	const legacy = legacyInputs as Record<string, Record<string, unknown>>;

	const updateTask: Record<string, Scenario> = {
		default: { id: '3', prompt: 'Use OAuth for the login flow' },
		append: { id: '3', prompt: 'Note the session store', append: true },
		'append research, no details': {
			id: '4',
			prompt: 'Add indexes',
			append: true,
			research: true
		},
		'with subtasks': { id: '2', prompt: 'Support short flags' },
		'string ids': { id: '3', prompt: 'Use OAuth', stringIds: true },
		'feature tag': { id: '2', prompt: 'Support short flags', tag: 'feature' }
	};
	for (const [name, s] of Object.entries(updateTask)) {
		it(`update-task matches the legacy command's: ${name}`, async () => {
			const sent = await capture(s, 'update-task', () =>
				tmCore.tasks.updateWithPrompt({ ...s, id: s.id as string })
			);
			expect(sent).toEqual(legacy['update-task'][name]);
		});
	}

	const updateFrom: Record<string, Scenario> = {
		default: { from: 3, prompt: 'Switch the database to Postgres' },
		research: { from: 3, prompt: 'Switch to Postgres', research: true },
		'from 1 skips done': { from: 1, prompt: 'Use TypeScript everywhere' },
		'string ids': { from: 2, prompt: 'Use TypeScript', stringIds: true },
		'feature tag': { from: 2, prompt: 'Use TypeScript', tag: 'feature' }
	};
	for (const [name, s] of Object.entries(updateFrom)) {
		it(`update matches the legacy command's: ${name}`, async () => {
			const sent = await capture(s, 'update-tasks', () =>
				tmCore.tasks.updateFrom({ ...s, from: s.from as number })
			);
			expect(sent).toEqual(legacy.update[name]);
		});
	}

	// The legacy reader ignored the report; tm-core's loader adds its fields
	it('leaves complexity report fields out of the prompt, as legacy did', async () => {
		const reports = path.join(projectDir, '.taskgraph', 'reports');
		fs.mkdirSync(reports, { recursive: true });
		fs.writeFileSync(
			path.join(reports, 'task-complexity-report.json'),
			JSON.stringify({
				meta: { generatedAt: '2026-01-01T00:00:00.000Z' },
				complexityAnalysis: [3, 4, 5].map((taskId) => ({
					taskId,
					taskTitle: `Task ${taskId}`,
					complexityScore: 7,
					recommendedSubtasks: 4,
					expansionPrompt: 'Split it',
					complexityReasoning: 'Many parts'
				}))
			})
		);

		const one = await capture(updateTask.default, 'update-task', () =>
			tmCore.tasks.updateWithPrompt(updateTask.default as any)
		);
		expect(one).toEqual(legacy['update-task'].default);

		ai.object.mockClear();
		const many = await capture(updateFrom.default, 'update-tasks', () =>
			tmCore.tasks.updateFrom(updateFrom.default as any)
		);
		expect(many).toEqual(legacy.update.default);
	});

	// The legacy command asked for a 'research' variant the prompt doesn't
	// have, so `update-task --research` failed before any AI call
	it('update-task --research uses the default prompt with its research wording', async () => {
		const sent = await capture(
			{ id: '3', prompt: 'Use OAuth', research: true },
			'update-task',
			() =>
				tmCore.tasks.updateWithPrompt({
					id: '3',
					prompt: 'Use OAuth',
					research: true
				})
		);

		const plain = legacy['update-task'].default as any;
		expect(sent.variant).toBe('default');
		expect(sent.role).toBe('research');
		expect(sent.vars.useResearch).toBe(true);
		expect(sent.prompt).toContain('with research-backed information');
		expect(sent.vars.gatheredContext).toBe(plain.vars.gatheredContext);
	});
});
