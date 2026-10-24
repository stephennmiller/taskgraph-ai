/**
 * @fileoverview Tests for the analyze_project_complexity and complexity_report
 * MCP tools: the arguments they hand tm-core and the reply shapes the legacy
 * tools had. tm-core is faked at the createTmCore boundary.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = { analyzeComplexity: vi.fn(), getComplexityReport: vi.fn() };
const config = { getActiveTag: vi.fn(() => 'master') };

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks, config }))
}));

import {
	registerAnalyzeComplexityTool,
	registerComplexityReportTool
} from './analyze-complexity.tool.js';

type Tool = {
	name: string;
	parameters: {
		parse: (v: unknown) => any;
		safeParse: (v: unknown) => { success: boolean };
	};
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(fn: (server: any) => void): Tool {
	const registered: Tool[] = [];
	fn({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: { env: { KEY: 'v' } }
};

const entry = (taskId: number, complexityScore: number) => ({
	taskId,
	taskTitle: `Task ${taskId}`,
	complexityScore,
	recommendedSubtasks: 3,
	expansionPrompt: '',
	reasoning: ''
});

let project: string;
const reply = (result: any) => JSON.parse(result.content[0].text);

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
	project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ac-')));
});

afterEach(() => {
	vi.unstubAllEnvs();
	fs.rmSync(project, { recursive: true, force: true });
});

describe('analyze_project_complexity', () => {
	const tool = register(registerAnalyzeComplexityTool);
	const report = {
		meta: { thresholdScore: 7 },
		complexityAnalysis: [entry(1, 9), entry(2, 6), entry(3, 2), entry(4, 8)]
	};

	beforeEach(() => {
		tasks.analyzeComplexity.mockResolvedValue({
			report,
			reportPath: `${project}/.taskgraph/reports/task-complexity-report.json`,
			telemetryData: { totalTokens: 4 },
			tagInfo: { currentTag: 'master', availableTags: ['master'] }
		});
	});

	it('reads a threshold given as a string as a number, 1 to 10 whole', () => {
		expect(tool.name).toBe('analyze_project_complexity');
		expect(
			tool.parameters.parse({ threshold: '7', projectRoot: project }).threshold
		).toBe(7);
		for (const threshold of [7.5, 11]) {
			expect(
				tool.parameters.safeParse({ threshold, projectRoot: project }).success
			).toBe(false);
		}
	});

	it('hands tm-core the options and replies with the legacy summary', async () => {
		const result = await tool.execute(
			tool.parameters.parse({
				threshold: 7,
				research: true,
				ids: '1,3',
				projectRoot: project
			}),
			ctx
		);

		expect(tasks.analyzeComplexity).toHaveBeenCalledWith(
			{
				ids: '1,3',
				from: undefined,
				to: undefined,
				threshold: 7,
				research: true,
				output: undefined,
				tag: 'master',
				session: ctx.session,
				outputType: 'mcp'
			},
			expect.any(Object)
		);
		const reportPath = `${project}/.taskgraph/reports/task-complexity-report.json`;
		expect(reply(result)).toMatchObject({
			data: {
				message: `Task complexity analysis complete. Report saved to ${reportPath}`,
				reportPath,
				reportSummary: {
					taskCount: 4,
					highComplexityTasks: 2,
					mediumComplexityTasks: 1,
					lowComplexityTasks: 1
				},
				fullReport: report,
				telemetryData: { totalTokens: 4 },
				tagInfo: { currentTag: 'master', availableTags: ['master'] }
			},
			tag: 'master'
		});
	});

	it('writes output inside the project and refuses one outside it', async () => {
		await tool.execute({ output: 'r/out.json', projectRoot: project }, ctx);
		expect(tasks.analyzeComplexity.mock.calls[0][0].output).toBe(
			path.join(project, 'r/out.json')
		);

		const outside = await tool.execute(
			{ output: '../report.json', projectRoot: project },
			ctx
		);
		expect(outside.isError).toBe(true);
		expect(outside.content[0].text).toContain('outside the project root');
		expect(tasks.analyzeComplexity).toHaveBeenCalledTimes(1);
	});

	it('refuses a tasks file other than the project one', async () => {
		const result = await tool.execute(
			{ file: 'other.json', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.analyzeComplexity).not.toHaveBeenCalled();
	});

	it('replies with the error tm-core threw, its hint included', async () => {
		tasks.analyzeComplexity.mockRejectedValue(
			Object.assign(new Error('"abc" isn\'t a threshold from 1 to 10'), {
				hint: 'Example: --threshold=6'
			})
		);

		const result = await tool.execute({ projectRoot: project }, ctx);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain(
			`Error: Error running core complexity analysis: "abc" isn't a threshold from 1 to 10. Example: --threshold=6`
		);
		expect(ctx.log.error).toHaveBeenCalledWith(
			expect.stringContaining('Error analyzing task complexity: ')
		);
	});

	it('logs tm-core warnings', async () => {
		tasks.analyzeComplexity.mockImplementation(async (_input, hooks) => {
			hooks.onWarning('No active tasks found with IDs: 9');
			return { report, reportPath: 'r', telemetryData: null };
		});

		await tool.execute({ projectRoot: project }, ctx);

		expect(ctx.log.warn).toHaveBeenCalledWith(
			'No active tasks found with IDs: 9'
		);
	});
});

describe('complexity_report', () => {
	const tool = register(registerComplexityReportTool);

	it("replies with the tag's report and its path", async () => {
		const found = { report: { meta: {} }, reportPath: '/p/r.json' };
		tasks.getComplexityReport.mockReturnValue(found);

		const result = await tool.execute({ projectRoot: project }, ctx);

		expect(tasks.getComplexityReport).toHaveBeenCalledWith({
			file: undefined
		});
		expect(reply(result).data).toEqual(found);
	});

	it('says to run analyze-complexity when there is no report', async () => {
		tasks.getComplexityReport.mockReturnValue(null);

		const missing = await tool.execute({ projectRoot: project }, ctx);
		const missingFile = await tool.execute(
			{ file: 'r.json', projectRoot: project },
			ctx
		);

		expect(missing.content[0].text).toContain(
			'Error: No complexity report found. Run taskgraph analyze-complexity first.'
		);
		expect(missingFile.content[0].text).toContain(
			`No complexity report found at ${path.join(project, 'r.json')}`
		);
	});

	it('refuses a file outside the project', async () => {
		const result = await tool.execute(
			{ file: '../r.json', projectRoot: project },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain('outside the project root');
		expect(tasks.getComplexityReport).not.toHaveBeenCalled();
	});
});
