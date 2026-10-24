/**
 * @fileoverview tasks.analyzeComplexity and tasks.getComplexityReport against
 * a real project. Only the AI call is mocked. The prompt inputs and saved
 * reports are compared with those the legacy command produced on the same
 * fixtures (the prompt is eval-gated, so they must not change).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { getPromptManager } from '../../../src/modules/ai/prompts/prompt-manager.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import legacyInputs from './__snapshots__/analyze-complexity-prompt-inputs.legacy.json' with {
	type: 'json'
};
import { answerFor, fixture, scenarios } from './analyze-complexity.fixture.js';

const reportName = (tag = 'master') =>
	tag === 'master'
		? 'task-complexity-report.json'
		: `task-complexity-report_${tag}.json`;

describe('tasks.analyzeComplexity', () => {
	let projectDir: string;
	let tmCore: TmCore | undefined;

	const reportPath = (tag?: string) =>
		path.join(projectDir, '.taskgraph', 'reports', reportName(tag));
	const readReport = (tag?: string) =>
		JSON.parse(fs.readFileSync(reportPath(tag), 'utf8'));
	const setUp = async (config: unknown = { models: {}, global: {} }) => {
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify(config)
		);
		tmCore = await createTmCore({ projectPath: projectDir });
		return tmCore;
	};

	beforeEach(() => {
		projectDir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-analyze-'))
		);
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'reports'), {
			recursive: true
		});
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(fixture())
		);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		tmCore = undefined;
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	describe('matches the legacy command', () => {
		for (const s of scenarios) {
			it(s.name, async () => {
				fs.writeFileSync(
					path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
					JSON.stringify(fixture(s.stringIds))
				);
				if (s.report) {
					fs.writeFileSync(reportPath(s.tag), JSON.stringify(s.report));
				}
				const load = vi.spyOn(getPromptManager(), 'loadPrompt');
				const generate = vi
					.spyOn(AiService.prototype, 'generateObject')
					.mockResolvedValue(answerFor(s) as any);
				const core = await setUp(s.config);

				await core.tasks.analyzeComplexity({
					ids: s.ids,
					from: s.from,
					to: s.to,
					threshold: s.threshold,
					research: s.research,
					tag: s.tag,
					outputType: 'mcp'
				});

				const call = load.mock.calls.find(
					(c) => c[0] === 'analyze-complexity'
				);
				const sent = generate.mock.calls[0]?.[0];
				const report = readReport(s.tag);
				delete report.meta.generatedAt;
				const scrub = (value: unknown) =>
					value === undefined
						? null
						: JSON.parse(JSON.stringify(value).split(projectDir).join('<root>'));
				expect(
					scrub({
						vars: call?.[1],
						variant: call?.[2],
						system: sent?.systemPrompt,
						prompt: sent?.prompt,
						role: sent?.role,
						objectName: sent?.objectName,
						commandName: sent?.commandName,
						report
					})
				).toEqual((legacyInputs as Record<string, unknown>)[s.name]);
			});
		}
	});

	describe('reports per tag', () => {
		const answer = (taskIds: number[]) => ({
			mainResult: {
				complexityAnalysis: taskIds.map((taskId) => ({
					taskId,
					taskTitle: `Task ${taskId}`,
					complexityScore: 6,
					recommendedSubtasks: 3,
					expansionPrompt: '',
					reasoning: ''
				}))
			},
			telemetryData: { totalTokens: 2 },
			tagInfo: { currentTag: 'feature', availableTags: [] }
		});

		it("writes a tag's report without touching master's", async () => {
			const master = { meta: {}, complexityAnalysis: [] };
			fs.writeFileSync(reportPath(), JSON.stringify(master));
			vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue(
				answer([2, 3, 4]) as any
			);
			const core = await setUp();

			const result = await core.tasks.analyzeComplexity({ tag: 'feature' });

			expect(result.reportPath).toBe(reportPath('feature'));
			expect(readReport('feature').complexityAnalysis).toHaveLength(3);
			expect(readReport()).toEqual(master);
			expect(result).toMatchObject({
				tag: 'feature',
				skipped: 0,
				kept: 0,
				unchanged: false,
				telemetryData: { totalTokens: 2 }
			});
		});

		it('writes to output, relative to the project root', async () => {
			vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue(
				answer([2, 3, 4, 5, 8]) as any
			);
			const core = await setUp();

			const result = await core.tasks.analyzeComplexity({
				output: 'out/report.json'
			});

			expect(result.reportPath).toBe(path.join(projectDir, 'out/report.json'));
			expect(fs.existsSync(result.reportPath)).toBe(true);
		});

		it('keeps entries another run saved while the AI was working', async () => {
			const core = await setUp();
			vi.spyOn(AiService.prototype, 'generateObject').mockImplementation(
				async () => {
					fs.writeFileSync(
						reportPath(),
						JSON.stringify({
							meta: {},
							complexityAnalysis: answer([8]).mainResult.complexityAnalysis
						})
					);
					return answer([2]) as any;
				}
			);

			const result = await core.tasks.analyzeComplexity({ ids: '2' });

			expect(
				readReport().complexityAnalysis.map((e: any) => e.taskId)
			).toEqual([8, 2]);
			expect(result.kept).toBe(1);
		});
	});

	describe('refuses before any AI call', () => {
		let generate: ReturnType<typeof vi.spyOn>;
		beforeEach(() => {
			generate = vi.spyOn(AiService.prototype, 'generateObject');
		});

		it('a tag that does not exist', async () => {
			const core = await setUp();

			await expect(
				core.tasks.analyzeComplexity({ tag: 'nope' })
			).rejects.toThrow('Tag "nope" not found.');
			expect(fs.existsSync(reportPath('nope'))).toBe(false);
			expect(generate).not.toHaveBeenCalled();
		});

		it('a tag with no tasks', async () => {
			fs.writeFileSync(
				path.join(projectDir, '.taskgraph', 'tasks', 'tasks.json'),
				JSON.stringify({ master: { tasks: [] } })
			);
			const core = await setUp();

			await expect(core.tasks.analyzeComplexity()).rejects.toThrow(
				'No tasks found in the tasks file'
			);
		});

		it('a threshold outside 1-10 or not a number', async () => {
			const core = await setUp();

			for (const threshold of ['abc', 0, '11']) {
				await expect(
					core.tasks.analyzeComplexity({ threshold })
				).rejects.toThrow("isn't a threshold from 1 to 10");
			}
			expect(generate).not.toHaveBeenCalled();
		});

		it('a report that exists but is not valid JSON, so its entries are not lost', async () => {
			fs.writeFileSync(reportPath(), '{ "complexityAnalysis": [');
			const core = await setUp();

			for (const ids of [undefined, '99']) {
				await expect(core.tasks.analyzeComplexity({ ids })).rejects.toThrow(
					"Couldn't read the complexity report"
				);
			}
			expect(fs.readFileSync(reportPath(), 'utf8')).toBe(
				'{ "complexityAnalysis": ['
			);
			expect(generate).not.toHaveBeenCalled();
		});

		it('an --id that is not a task ID', async () => {
			const core = await setUp();

			for (const ids of ['abc', '2,abc', ' , ']) {
				await expect(core.tasks.analyzeComplexity({ ids })).rejects.toThrow(
					"isn't a task ID"
				);
			}
			expect(generate).not.toHaveBeenCalled();
		});
	});

	it('analyzes named tasks whatever their status with anyStatus', async () => {
		const generate = vi
			.spyOn(AiService.prototype, 'generateObject')
			.mockResolvedValue(answerFor({ name: '', ids: '2' }) as any);
		const core = await setUp();

		const result = await core.tasks.analyzeComplexity({
			ids: '1',
			anyStatus: true
		});

		const sent = generate.mock.calls[0]?.[0];
		expect(sent?.prompt).toContain('Set up project scaffolding');
		expect(result).toMatchObject({ skipped: 0, unchanged: false });
	});

	it('warns about IDs with no active task', async () => {
		vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue(
			answerFor({ name: '', ids: '2,6,42' }) as any
		);
		const core = await setUp();
		const warnings: string[] = [];

		await core.tasks.analyzeComplexity(
			{ ids: '2,6,42' },
			{ onWarning: (message) => warnings.push(message) }
		);

		expect(warnings).toContain(
			'Some requested task IDs were not found or are not active: 6, 42'
		);
	});

	it('throws, and leaves the report alone, when the AI returns no analysis', async () => {
		vi.spyOn(AiService.prototype, 'generateObject').mockResolvedValue({
			mainResult: {},
			telemetryData: null
		} as any);
		const core = await setUp();

		await expect(core.tasks.analyzeComplexity()).rejects.toThrow(
			'AI service did not return a complexity analysis.'
		);
		expect(fs.existsSync(reportPath())).toBe(false);
	});
});

describe('tasks.getComplexityReport', () => {
	let projectDir: string;
	let tmCore: TmCore;
	const reports = () => path.join(projectDir, '.taskgraph', 'reports');

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-report-'));
		fs.mkdirSync(reports(), { recursive: true });
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'tasks'));
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("reads the tag's report, under an older name too", () => {
		const report = { meta: {}, complexityAnalysis: [] };
		fs.writeFileSync(
			path.join(reports(), 'complexity-report_feature.json'),
			JSON.stringify(report)
		);

		expect(tmCore.tasks.getComplexityReport({ tag: 'feature' })).toEqual({
			report,
			reportPath: path.join(reports(), 'complexity-report_feature.json')
		});
		expect(tmCore.tasks.getComplexityReport()).toBeNull();
	});

	it('finds an older report name in a project whose path holds the name', async () => {
		const root = path.join(projectDir, 'task-complexity-report-demo');
		fs.mkdirSync(path.join(root, '.taskgraph', 'reports'), { recursive: true });
		fs.mkdirSync(path.join(root, '.taskgraph', 'tasks'));
		fs.writeFileSync(
			path.join(root, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		const file = path.join(root, '.taskgraph', 'reports', 'complexity-report.json');
		fs.writeFileSync(file, '{"meta":{}}');
		const core = await createTmCore({ projectPath: root });

		expect(core.tasks.getComplexityReport()?.reportPath).toBe(file);
		await core.close();
	});

	it('reads a file given relative to the project root', () => {
		fs.writeFileSync(path.join(projectDir, 'r.json'), '{"meta":{}}');

		expect(tmCore.tasks.getComplexityReport({ file: 'r.json' })?.report).toEqual(
			{ meta: {} }
		);
	});

	it('says when the report is not valid JSON', () => {
		fs.writeFileSync(path.join(reports(), reportName()), '{');

		expect(() => tmCore.tasks.getComplexityReport()).toThrow(
			"Couldn't read the complexity report"
		);
	});
});
