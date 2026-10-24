/**
 * @fileoverview tasks.research and saveResearch against a real project. Only
 * the AI call is mocked: the checks before it, the context the model gets,
 * and the saves, including one that keeps edits made during the AI call.
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
	description: `${title} description`,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	subtasks: [],
	...extra
});

const answer = (text = 'Use connect-pg-simple.') => ({
	mainResult: `<think>hmm</think>${text}`,
	telemetryData: { totalTokens: 10 },
	tagInfo: { currentTag: 'master', availableTags: ['master'] }
});

describe('tasks.research', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;
	let generateText: ReturnType<typeof vi.spyOn>;

	const readFile = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
	const prompt = () => generateText.mock.calls[0][0] as any;

	beforeEach(async () => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-research-'))
		);
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: {
					tasks: [
						task(1, 'Database schema'),
						task(2, 'Session store', {
							details: 'Use argon2.',
							subtasks: [
								{
									id: 1,
									title: 'Pick a library',
									status: 'pending',
									details: ''
								}
							]
						})
					],
					metadata: {}
				},
				feature: { tasks: [task(1, 'Feature task')], metadata: {} }
			})
		);
		fs.mkdirSync(path.join(projectDir, 'src'));
		fs.writeFileSync(
			path.join(projectDir, 'src', 'a.js'),
			'export const a = 1;'
		);
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

	it('asks the research role with tasks, files, tree and notes as context', async () => {
		const onAiCall = vi.fn();

		const result = await tmCore.tasks.research(
			{
				query: '  How should we store sessions?  ',
				taskIds: ['2.1'],
				filePaths: ['src/a.js'],
				customContext: 'We use Postgres',
				includeProjectTree: true,
				detailLevel: 'HIGH'
			},
			{ onAiCall }
		);

		expect(prompt()).toMatchObject({
			role: 'research',
			commandName: 'research'
		});
		const sent = prompt().prompt as string;
		expect(sent).toContain('How should we store sessions?');
		expect(sent).toContain('## Additional Context\n\nWe use Postgres');
		expect(sent).toContain('**Subtask 2.1: Pick a library**');
		expect(sent).toContain('**File: src/a.js** (0KB)');
		expect(sent).toContain('## Project Structure');
		expect(sent).toContain('high-detail');
		expect(result).toMatchObject({
			query: 'How should we store sessions?',
			result: 'Use connect-pg-simple.',
			detailLevel: 'high',
			taskIds: ['2.1'],
			telemetryData: { totalTokens: 10 },
			saveFailures: []
		});
		expect(result.tokenBreakdown.tasks[0]).toMatchObject({
			id: '2.1',
			type: 'subtask',
			title: 'Pick a library',
			parentTitle: 'Session store'
		});
		expect(result.tokenBreakdown.files[0]).toMatchObject({ path: 'src/a.js' });
		expect(result.contextTokens).toBe(result.tokenBreakdown.total);
		expect(result.tokenBreakdown.total).toBeGreaterThan(0);
		expect(onAiCall).toHaveBeenCalledWith(
			expect.objectContaining({
				taskIds: ['2.1'],
				files: ['src/a.js'],
				projectTree: true,
				customContext: true
			})
		);
		// Nothing was saved
		expect(readFile().master.tasks[1].details).toBe('Use argon2.');
	});

	it('adds tasks matching the question to the ones you named', async () => {
		const result = await tmCore.tasks.research({
			query: 'Session store',
			taskIds: ['1']
		});

		expect(result.relatedTaskIds).toContain('2');
		expect(result.relatedTaskIds).not.toContain('1');
		expect(prompt().prompt).toContain('**Task 2: Session store**');
	});

	it.each([
		[{ taskIds: ['9'] }, "Task 9 doesn't exist in tag 'master'"],
		[{ saveTo: '2.4' }, "Subtask 2.4 doesn't exist in tag 'master'"],
		[{ taskIds: ['abc'] }, '"abc" isn\'t a task ID'],
		[{ detailLevel: 'extreme' }, 'low, medium or high'],
		[{ query: '  ' }, 'Research needs a question'],
		[{ filePaths: ['missing.js'] }, 'File not found: missing.js'],
		[{ tag: 'nope' }, 'Tag "nope" not found']
	])('refuses %o before any AI call', async (input, message) => {
		await expect(
			tmCore.tasks.research({ query: 'q', ...input })
		).rejects.toThrow(message);
		expect(generateText).not.toHaveBeenCalled();
	});

	it('reads the tasks of the tag it is given', async () => {
		await expect(
			tmCore.tasks.research({ query: 'q', taskIds: ['2'], tag: 'feature' })
		).rejects.toThrow("Task 2 doesn't exist in tag 'feature'");
		await tmCore.tasks.research({ query: 'q', taskIds: ['1'], tag: 'feature' });
		expect(prompt().prompt).toContain('Feature task');
	});

	it('appends the answer to a task, keeping edits made during the AI call', async () => {
		generateText.mockImplementation(async () => {
			// Another writer changes the file while the model is answering
			const data = readFile();
			data.master.tasks[0].title = 'Renamed meanwhile';
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return answer() as any;
		});

		const result = await tmCore.tasks.research({
			query: 'sessions?',
			saveTo: '2'
		});

		expect(result.savedTo).toEqual({ id: '2', title: 'Session store' });
		const saved = readFile().master.tasks;
		expect(saved[0].title).toBe('Renamed meanwhile');
		expect(saved[1].details).toMatch(
			/^Use argon2\.\n<info added on (.+)>\n## Research: sessions\?\n\nUse connect-pg-simple\.\n<\/info added on \1>$/
		);
	});

	it('keeps the answer and reports a save that fails after the AI call', async () => {
		generateText.mockImplementation(async () => {
			const data = readFile();
			data.master.tasks = data.master.tasks.slice(0, 1);
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return answer() as any;
		});

		const result = await tmCore.tasks.research({ query: 'q', saveTo: '2' });

		expect(result.result).toBe('Use connect-pg-simple.');
		expect(result.savedTo).toBeUndefined();
		expect(result.saveFailures).toEqual([
			expect.objectContaining({ kind: 'task', id: '2' })
		]);
	});

	it('reports a save to a tag deleted during the AI call, without recreating it', async () => {
		generateText.mockImplementation(async () => {
			const data = readFile();
			delete data.feature;
			fs.writeFileSync(tasksPath, JSON.stringify(data));
			return answer() as any;
		});

		const result = await tmCore.tasks.research({
			query: 'q',
			saveTo: '1',
			tag: 'feature'
		});

		expect(result.result).toBe('Use connect-pg-simple.');
		expect(result.saveFailures).toEqual([
			expect.objectContaining({ kind: 'task', id: '1' })
		]);
		expect(Object.keys(readFile())).toEqual(['master']);
	});

	it('saves the answer to .taskgraph/docs/research and to a file you name', async () => {
		const result = await tmCore.tasks.research({
			query: 'How to cache?',
			saveToFile: true,
			saveAs: path.join(projectDir, 'notes', 'cache.md')
		});

		expect(result.savedFilePath).toMatch(
			/\.taskgraph\/docs\/research\/\d{4}-\d{2}-\d{2}_how-to-cache\.md$/
		);
		const doc = fs.readFileSync(result.savedFilePath as string, 'utf8');
		expect(doc).toContain('query: "How to cache?"');
		expect(doc).toContain('## Initial Query\n\n**Question:** How to cache?');
		expect(
			fs.readFileSync(path.join(projectDir, 'notes', 'cache.md'), 'utf8')
		).toBe('# Research: How to cache?\n\nUse connect-pg-simple.\n');
	});

	it('refuses a --save path outside the project before any AI call', async () => {
		await expect(
			tmCore.tasks.research({
				query: 'q',
				saveAs: path.join(projectDir, '..', 'out.md')
			})
		).rejects.toThrow('must be inside the project');
		expect(generateText).not.toHaveBeenCalled();
	});

	it('refuses a --save path that is a folder before any AI call', async () => {
		await expect(
			tmCore.tasks.research({ query: 'q', saveAs: projectDir })
		).rejects.toThrow("it's a folder");
		expect(generateText).not.toHaveBeenCalled();
	});

	it('treats an empty saveTo as no save, as legacy MCP did', async () => {
		const result = await tmCore.tasks.research({ query: 'q', saveTo: '' });
		expect(result.savedTo).toBeUndefined();
		expect(result.saveFailures).toEqual([]);
	});

	it('gives a follow-up the conversation so far and saves the whole conversation', async () => {
		const first = await tmCore.tasks.research({
			query: 'First?',
			customContext: 'notes'
		});
		generateText.mockResolvedValue(answer('Second answer') as any);

		const second = await tmCore.tasks.research({
			query: 'Second?',
			customContext: 'notes',
			history: [first.exchange]
		});

		const sent = (generateText.mock.calls[1][0] as any).prompt as string;
		expect(sent).toContain('--- Conversation History ---');
		expect(sent).toContain('Initial Question: First?');
		expect(sent).toContain('--- Original Context ---\nnotes');
		expect(second.exchange.type).toBe('followup');

		const saved = await tmCore.tasks.saveResearch(
			[first.exchange, second.exchange],
			{ taskId: '1' }
		);
		expect(saved).toEqual({ kind: 'task', id: '1', title: 'Database schema' });
		const details = readFile().master.tasks[0].details;
		expect(details).toContain('**Initial Query:** First?');
		expect(details).toContain('**Follow-up 1:** Second?');
		expect(details).toContain('**Response:** Second answer');
	});
});
