/**
 * @fileoverview tasks.updateSubtask against a real tasks.json. Only the AI
 * call is mocked: the prompt inputs (against captures from the legacy
 * update-subtask-by-id.js), ID checks, the timestamped save, metadata, an
 * empty answer, and edits made while the AI was writing.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { getPromptManager } from '../../../src/modules/ai/prompts/prompt-manager.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import legacyInputs from './__snapshots__/update-subtask-prompt-inputs.legacy.json' with {
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
				sub(2, 'Parse commands', {
					dependencies: [1],
					details: 'Use a table of commands'
				}),
				sub(3, 'Print help')
			]
		}),
		task(id(3), 'Add user authentication', { dependencies: [id(1), id(2)] }),
		task(id(4), 'Database schema for users', {
			subtasks: [sub(1, 'Users table')]
		}),
		task(id(5), 'Deploy pipeline and release builds', {
			subtasks: [sub(1, 'Configure CI'), sub(2, 'Publish')]
		}),
		task(id(6), 'Display task list in the UI', { status: 'done' }),
		task(id(7), 'Research prompt models for AI integration')
	];
	return {
		master: { tasks, metadata: {} },
		feature: { tasks: tasks.slice(0, 3), metadata: {} }
	};
}

const answer = (text = '  Map ls to list.\n') => ({
	mainResult: text,
	telemetryData: { totalTokens: 1 },
	tagInfo: { currentTag: 'master' }
});

const ISO = /\d{4}-\d\d-\d\dT[\d:.]+Z/g;

describe('tasks.updateSubtask', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateText: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data));
	const subtaskIn = (data: any, parent: number, id: number, tag = 'master') =>
		data[tag].tasks
			.find((t: any) => String(t.id) === String(parent))
			.subtasks.find((s: any) => String(s.id) === String(id));

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-update-subtask-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write(fixture());
		generateText = vi
			.spyOn(AiService.prototype, 'generateText')
			.mockResolvedValue(answer() as any);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	describe('prompt inputs', () => {
		// Captured from the legacy update-subtask-by-id.js on the same fixture
		const scenarios: Record<string, Record<string, any>> = {
			'middle subtask': {
				id: '2.2',
				prompt: 'Add an alias table so ls maps to list'
			},
			research: {
				id: '2.2',
				prompt: 'Which parser library is fastest?',
				research: true
			},
			'first subtask': { id: '2.1', prompt: 'Note the flag syntax' },
			'last subtask': { id: '5.2', prompt: 'Publish to npm with provenance' },
			'only subtask': { id: '4.1', prompt: 'Users need an email index' },
			'string ids': {
				id: '2.3',
				prompt: 'Help text from command descriptions',
				stringIds: true
			},
			'feature tag': {
				id: '2.2',
				prompt: 'Feature work on commands',
				tag: 'feature'
			}
		};

		for (const [name, s] of Object.entries(scenarios)) {
			it(`match the legacy command's: ${name}`, async () => {
				const tag = s.tag ?? 'master';
				write(fixture(s.stringIds));
				const loadPrompt = vi.spyOn(getPromptManager(), 'loadPrompt');

				await tmCore.tasks.updateSubtask({
					id: s.id,
					prompt: s.prompt,
					research: s.research,
					tag
				});

				const [, vars, variant] = loadPrompt.mock.calls.find(
					(c) => c[0] === 'update-subtask'
				) as any;
				const call = generateText.mock.calls[0][0] as any;
				const mask = (text: string) =>
					text
						.split(projectDir)
						.join('<root>')
						.replace(ISO, '<ts>')
						.replace(/\[Updated: [^\]]+\]/g, '[Updated: <date>]');
				const [parent, subId] = s.id.split('.').map(Number);
				const saved = subtaskIn(readFile(), parent, subId, tag);
				expect(variant).toBe('default');
				expect({
					vars: JSON.parse(mask(JSON.stringify(vars))),
					role: call.role,
					commandName: call.commandName,
					system: mask(call.systemPrompt),
					prompt: mask(call.prompt),
					savedDetails: mask(saved.details),
					savedDescription: mask(saved.description)
				}).toEqual((legacyInputs as Record<string, unknown>)[name]);
			});
		}
	});

	it('appends the trimmed answer as one timestamped block', async () => {
		const result = await tmCore.tasks.updateSubtask({
			id: '2.2',
			prompt: 'Aliases'
		});

		const details = subtaskIn(readFile(), 2, 2).details as string;
		const [time] = details.match(ISO) ?? [];
		expect(details).toBe(
			`Use a table of commands\n<info added on ${time}>\nMap ls to list.\n</info added on ${time}>`
		);
		expect(result).toMatchObject({
			id: '2.2',
			parentId: '2',
			added: 'Map ls to list.',
			telemetryData: { totalTokens: 1 },
			tag: 'master'
		});
		expect(result.subtask.details).toBe(details);
	});

	// #700: the reply gave the stored [1], which reads as task 1
	it('replies with full-ID dependencies and keeps the stored form', async () => {
		const result = await tmCore.tasks.updateSubtask({
			id: '2.2',
			prompt: 'Aliases'
		});

		expect(result.subtask.dependencies).toEqual(['2.1']);
		expect(subtaskIn(readFile(), 2, 2).dependencies).toEqual([1]);
	});

	it.each([
		['', 'Subtask ID cannot be empty.'],
		['invalid', 'Invalid subtask ID format: invalid'],
		['2', 'Invalid subtask ID format: 2'],
		['2.0', 'must be positive integers'],
		['2.x', 'must be positive integers'],
		['2.1.1', 'must be positive integers'],
		['9.1', 'Task 9 not found'],
		['1.1', 'Parent task 1 has no subtasks.'],
		['2.9', 'Subtask 2.9 not found']
	])('refuses %j before the AI call', async (id, message) => {
		write({
			...fixture(),
			master: {
				tasks: fixture().master.tasks.map((t) =>
					t.id === 1 ? { ...t, subtasks: undefined } : t
				),
				metadata: {}
			}
		});
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(
			tmCore.tasks.updateSubtask({ id, prompt: 'x' })
		).rejects.toThrow(message);
		expect(generateText).not.toHaveBeenCalled();
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('refuses an empty prompt without metadata', async () => {
		await expect(
			tmCore.tasks.updateSubtask({ id: '2.2', prompt: '  ' })
		).rejects.toThrow('Prompt cannot be empty');
		expect(generateText).not.toHaveBeenCalled();
	});

	it('saves nothing when the AI returns no text', async () => {
		generateText.mockResolvedValue(answer('  \n') as any);
		const before = fs.readFileSync(tasksPath, 'utf8');

		const result = await tmCore.tasks.updateSubtask({
			id: '2.2',
			prompt: 'Aliases'
		});

		expect(result.added).toBe('');
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('merges metadata without the AI, never the reserved link keys', async () => {
		const data = fixture();
		(data.master.tasks[1].subtasks[0] as any).metadata = {
			taskLinks: { 3: 'related' }
		};
		write(data);

		const result = await tmCore.tasks.updateSubtask({
			id: '2.1',
			metadata: { owner: 'kim', taskLinks: { 9: 'related' } }
		});

		expect(generateText).not.toHaveBeenCalled();
		expect(subtaskIn(readFile(), 2, 1).metadata).toEqual({
			taskLinks: { 3: 'related' },
			owner: 'kim'
		});
		expect(result).toMatchObject({
			telemetryData: null,
			tagInfo: { tag: 'master' }
		});
	});

	it('saves metadata with the notes, and alone when the AI returns none', async () => {
		await tmCore.tasks.updateSubtask({
			id: '2.2',
			prompt: 'Aliases',
			metadata: { owner: 'kim' }
		});
		expect(subtaskIn(readFile(), 2, 2)).toMatchObject({
			metadata: { owner: 'kim' },
			details: expect.stringContaining('Map ls to list.')
		});

		generateText.mockResolvedValue(answer('') as any);
		await tmCore.tasks.updateSubtask({
			id: '2.3',
			prompt: 'Aliases',
			metadata: { owner: 'lee' }
		});
		expect(subtaskIn(readFile(), 2, 3)).toMatchObject({
			metadata: { owner: 'lee' },
			details: ''
		});
	});

	it('keeps edits made while the AI was writing', async () => {
		generateText.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[0].status = 'done';
			subtaskIn(data, 2, 2).status = 'in-progress';
			write(data);
			return answer() as any;
		});

		await tmCore.tasks.updateSubtask({ id: '2.2', prompt: 'Aliases' });

		const data = readFile();
		expect(data.master.tasks[0].status).toBe('done');
		expect(subtaskIn(data, 2, 2)).toMatchObject({
			status: 'in-progress',
			details: expect.stringContaining('Map ls to list.')
		});
	});

	it('fails cleanly when the subtask is deleted during the AI call', async () => {
		generateText.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks[1].subtasks = data.master.tasks[1].subtasks.filter(
				(s: any) => s.id !== 2
			);
			write(data);
			return answer() as any;
		});

		await expect(
			tmCore.tasks.updateSubtask({ id: '2.2', prompt: 'Aliases' })
		).rejects.toThrow('Subtask 2.2 not found');
		expect(readFile().master.tasks[1].subtasks).toHaveLength(2);
	});
});
