/**
 * @fileoverview Tests for the parse_prd MCP tool: the arguments it hands
 * tm-core, its path checks, and the reply shapes the legacy tool had.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { parsePrd: vi.fn(), findPrdGaps: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import { createTmCore } from '@tm/core';
import { registerParsePrdTool } from './parse-prd.tool.js';

type Tool = {
	name: string;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

const tool = (): Tool => {
	const registered: Tool[] = [];
	registerParsePrdTool({ addTool: (t: Tool) => registered.push(t) } as any);
	return registered[0];
};

const reportProgress = vi.fn();
const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: { env: { KEY: 'v' } },
	reportProgress
};
const reply = (result: any) => JSON.parse(result.content[0].text);
const telemetryData = {
	inputTokens: 1200,
	outputTokens: 300,
	totalCost: 0.0123,
	currency: 'USD'
};

let project: string;
let prd: string;

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'prd-')));
	prd = path.join(project, 'prd.md');
	fs.writeFileSync(prd, '# Bookmarks\n');
	tasks.parsePrd.mockResolvedValue({
		tag: 'master',
		prdPath: prd,
		tasksPath: path.join(project, '.taskgraph/tasks/tasks.json'),
		added: 3,
		total: 3,
		prdDelta: null,
		telemetryData,
		tagInfo: { currentTag: 'master', availableTags: ['master'] },
		estimatedInputTokens: 900
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

describe('parse_prd', () => {
	it('hands tm-core the arguments and replies as before', async () => {
		const result = await tool().execute(
			{
				projectRoot: project,
				input: 'prd.md',
				numTasks: '5',
				force: true,
				research: true,
				tag: 'feature'
			},
			ctx
		);

		expect(tasks.parsePrd).toHaveBeenCalledWith(
			{
				prdPath: prd,
				numTasks: '5',
				force: true,
				append: false,
				research: true,
				tag: 'feature',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		const tasksPath = path.join(project, '.taskgraph/tasks/tasks.json');
		expect(reply(result).data).toEqual({
			message: `Successfully parsed PRD and generated tasks in ${tasksPath}`,
			outputPath: tasksPath,
			addedTasks: 3,
			telemetryData,
			tagInfo: { currentTag: 'master', availableTags: ['master'] }
		});
		expect(reportProgress).toHaveBeenCalledWith({
			progress: 3,
			total: 3,
			message:
				'Task generation complete | Tokens (I/O): 1200/300 | Cost: $0.0123'
		});
	});

	it('hands tm-core the PRD under the project root as given, not its real path', async () => {
		// macOS /tmp is a symlink: a realpath here would not sit under tm-core's root
		const link = `${project}-link`;
		fs.symlinkSync(project, link);
		try {
			await tool().execute({ projectRoot: link, input: 'prd.md' }, ctx);
		} finally {
			fs.rmSync(link);
		}

		expect(tasks.parsePrd).toHaveBeenCalledWith(
			expect.objectContaining({ prdPath: path.join(link, 'prd.md') }),
			expect.any(Object)
		);
	});

	it('still replies with the saved tasks when the progress report fails', async () => {
		reportProgress.mockRejectedValueOnce(new Error('client went away'));

		const result = await tool().execute(
			{ projectRoot: project, input: prd },
			ctx
		);

		expect(result.isError).toBeFalsy();
		expect(reply(result).data.addedTasks).toBe(3);
	});

	it('loads tm-core for each call, so models and language saved since the last one apply', async () => {
		await tool().execute({ projectRoot: project, input: prd }, ctx);
		await tool().execute({ projectRoot: project, input: prd }, ctx);

		expect(vi.mocked(createTmCore)).toHaveBeenCalledTimes(2);
	});

	it('lists the PRD changes an append found, and adds nothing for no new sections', async () => {
		tasks.parsePrd.mockResolvedValue({
			tag: 'master',
			tasksPath: 'tasks.json',
			added: 0,
			total: 2,
			prdDelta: {
				path: 'prd.md',
				known: true,
				added: [],
				changed: [{ slug: 'notes', title: 'Notes', taskIds: ['2'] }],
				removed: [{ slug: 'sharing', title: 'Sharing', taskIds: ['3'] }]
			},
			telemetryData: null,
			tagInfo: null,
			estimatedInputTokens: 0
		});

		const result = await tool().execute(
			{ projectRoot: project, input: prd, append: true },
			ctx
		);

		expect(reply(result).data).toEqual({
			message: 'No new sections in prd.md; no tasks added',
			outputPath: 'tasks.json',
			addedTasks: 0,
			prdChanges: {
				prd: 'prd.md',
				newSections: [],
				changedSections: [{ section: 'notes', mayBeStale: ['2'] }],
				removedSections: [{ section: 'sharing', tasks: ['3'] }]
			},
			telemetryData: null,
			tagInfo: null
		});
		expect(reportProgress).not.toHaveBeenCalled();
	});

	it('clarify returns the questions and generates nothing', async () => {
		const questions = [{ question: 'Which DB?', suggestedAnswer: 'SQLite' }];
		tasks.findPrdGaps.mockResolvedValue({
			prdPath: prd,
			questions,
			telemetryData
		});

		const result = await tool().execute(
			{ projectRoot: project, input: prd, clarify: true },
			ctx
		);

		expect(reply(result).data).toEqual({
			message:
				'Ask the user these 1 questions, then call parse_prd with their answers in clarifications',
			questions,
			telemetryData
		});
		expect(tasks.parsePrd).not.toHaveBeenCalled();
	});

	it('saves clarifications in the PRD before the tasks are generated', async () => {
		tasks.parsePrd.mockImplementation(async () => {
			expect(fs.readFileSync(prd, 'utf8')).toContain('**A:** SQLite');
			return {
				tasksPath: 't',
				added: 1,
				total: 1,
				prdDelta: null,
				telemetryData: null,
				tagInfo: null,
				estimatedInputTokens: 5
			};
		});

		const result = await tool().execute(
			{
				projectRoot: project,
				input: prd,
				clarifications: [{ question: 'Which DB?', answer: 'SQLite' }]
			},
			ctx
		);

		expect(reply(result).data.clarifications).toEqual({
			added: 1,
			updated: 0,
			unchanged: 0
		});
		expect(reportProgress).toHaveBeenCalledWith(
			expect.objectContaining({
				message:
					'Task generation complete | ~Tokens (I/O): 5/unknown | Cost: ~$0.00'
			})
		);
	});

	it.each([
		[{ input: '../secrets/.env' }, 'outside the project root'],
		[{ input: 'missing.md' }, 'Input PRD file not found at resolved path'],
		[
			{ input: 'prd.md', output: '../elsewhere/tasks.json' },
			"a different file isn't supported"
		],
		[
			{ input: 'prd.md', clarify: true, clarifications: [] },
			'Pass clarify to get questions, or clarifications to save answers, not both'
		]
	])('refuses %o before any AI call', async (args, message) => {
		const result = await tool().execute({ projectRoot: project, ...args }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(message);
		expect(tasks.parsePrd).not.toHaveBeenCalled();
		expect(tasks.findPrdGaps).not.toHaveBeenCalled();
	});
});
