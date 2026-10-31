/**
 * @fileoverview Unit tests for `analyze-complexity [--report]` and its hidden
 * alias `complexity-report`:
 * what they hand tm-core, what they print, and how they fail.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

vi.mock('../utils/project-root.js', () => ({
	getProjectRoot: () => '/test/project'
}));

vi.mock('../utils/display-helpers.js', () => ({
	displayCommandHeader: () => false
}));

import { createTmCore } from '@tm/core';
import { AnalyzeComplexityCommand } from './analyze-complexity.command.js';
import { ComplexityReportCommand } from './complexity-report.command.js';

const analyzeComplexity = vi.fn();
const getComplexityReport = vi.fn();
const strip = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const entry = (taskId: number, taskTitle: string, complexityScore: number) => ({
	taskId,
	taskTitle,
	complexityScore,
	recommendedSubtasks: 4,
	expansionPrompt: '',
	reasoning: 'Touches the \x1b[31mdatabase'
});

describe('analyze-complexity and complexity-report', () => {
	let out: string[];
	let err: string[];

	beforeEach(() => {
		vi.clearAllMocks();
		out = [];
		err = [];
		vi.spyOn(console, 'log').mockImplementation((...a) => {
			out.push(strip(a.join(' ')));
		});
		vi.spyOn(console, 'error').mockImplementation((...a) => {
			err.push(strip(a.join(' ')));
		});
		vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
			throw new Error(`exit ${code}`);
		}) as never);
		vi.mocked(createTmCore).mockResolvedValue({
			tasks: { analyzeComplexity, getComplexityReport },
			config: { getActiveTag: () => 'master' }
		} as any);
		analyzeComplexity.mockImplementation(async (_input, hooks) => {
			hooks.onWarning('Some requested task IDs were not found: 9');
			hooks.onAiCall({ taskCount: 2 });
			return {
				analyses: [entry(3, 'Sign-in \x1b[31mflow', 7), entry(4, 'CRUD', 3)],
				skipped: 1,
				kept: 2,
				unchanged: false,
				reportPath:
					'/test/project/.taskgraph/reports/task-complexity-report.json',
				telemetryData: {
					modelUsed: 'sonnet',
					inputTokens: 10,
					outputTokens: 5,
					totalTokens: 15
				}
			};
		});
	});

	const analyze = (...args: string[]) =>
		new AnalyzeComplexityCommand().parseAsync(args, { from: 'user' });
	const report = (...args: string[]) =>
		new ComplexityReportCommand().parseAsync(args, { from: 'user' });

	it('hands tm-core the options as typed', async () => {
		await analyze('--id=3,4,9', '--threshold=7', '--research', '--tag=feat');

		expect(analyzeComplexity.mock.calls[0][0]).toEqual({
			ids: '3,4,9',
			from: undefined,
			to: undefined,
			threshold: '7',
			research: true,
			output: undefined,
			tag: 'feat',
			outputType: 'cli'
		});
	});

	it('passes --from, --to and --output, and accepts the old --model', async () => {
		await analyze('--from=2', '--to=5', '-o', 'out.json', '-m', 'opus');

		expect(analyzeComplexity.mock.calls[0][0]).toMatchObject({
			from: '2',
			to: '5',
			output: 'out.json',
			threshold: '5'
		});
	});

	it('prints the warning, the analyzed tasks, the report path and usage', async () => {
		await analyze();

		const text = out.join('\n');
		expect(text).toContain('⚠ Some requested task IDs were not found: 9');
		expect(text).toContain('✓ Analyzed 2 tasks · skipped 1 done');
		expect(text).toContain('Sign-in flow');
		expect(text).not.toContain('\x1b[31m');
		expect(text).toContain(
			'Saved to .taskgraph/reports/task-complexity-report.json, with 2 earlier analyses'
		);
		expect(text).toContain('15 tokens');
	});

	it('says when the report was left as it was', async () => {
		analyzeComplexity.mockResolvedValue({ unchanged: true });

		await analyze('--id=1');

		expect(out).toEqual(['The complexity report is unchanged']);
	});

	it('exits 1 with the reason and hint when analysis fails', async () => {
		analyzeComplexity.mockRejectedValue(
			Object.assign(new Error('"abc" isn\'t a threshold from 1 to 10'), {
				hint: 'Example: --threshold=6'
			})
		);

		await expect(analyze('--threshold=abc')).rejects.toThrow('exit 1');
		const text = err.join('\n');
		expect(text).toContain(
			`Couldn't analyze task complexity: "abc" isn't a threshold from 1 to 10`
		);
		expect(text).toContain('Example: --threshold=6');
	});

	it('refuses a --file other than the project tasks file', async () => {
		await expect(analyze('--file=other.json')).rejects.toThrow('exit 1');
		expect(analyzeComplexity).not.toHaveBeenCalled();
	});

	it("complexity-report shows the tag's report, or a file", async () => {
		getComplexityReport.mockReturnValue({
			report: {
				meta: { generatedAt: '2026-10-01T00:00:00Z', thresholdScore: 5 },
				complexityAnalysis: [entry(3, 'Sign-in flow', 7)]
			},
			reportPath: 'r.json'
		});

		await report('--tag=feat');
		await report('-f', 'custom.json');

		expect(getComplexityReport.mock.calls).toEqual([
			[{ tag: 'feat', file: undefined }],
			[{ tag: 'master', file: 'custom.json' }]
		]);
		expect(out.join('\n')).toContain('Sign-in flow');
	});

	it('analyze-complexity --report shows the report without analyzing (#882)', async () => {
		getComplexityReport.mockReturnValue({
			report: {
				meta: { generatedAt: '2026-10-01T00:00:00Z', thresholdScore: 5 },
				complexityAnalysis: [entry(3, 'Sign-in flow', 7)]
			},
			reportPath: 'r.json'
		});

		await analyze('--report', '--tag=feat');
		await analyze('--report', 'custom.json');

		expect(getComplexityReport.mock.calls).toEqual([
			[{ tag: 'feat', file: undefined }],
			[{ tag: 'master', file: 'custom.json' }]
		]);
		expect(analyzeComplexity).not.toHaveBeenCalled();
		expect(out.join('\n')).toContain('Sign-in flow');
	});

	it('complexity-report exits 1 with how to make one when there is none', async () => {
		getComplexityReport.mockReturnValue(null);

		await expect(report()).rejects.toThrow('exit 1');
		expect(err.join('\n')).toContain('No complexity report for this tag yet');
	});
});
