import { describe, expect, it } from 'vitest';
import {
	type ComplexityAnalysisItem,
	formatComplexityReport,
	formatComplexityRun
} from './complexity-report-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const analyses: ComplexityAnalysisItem[] = [
	{
		taskId: 2,
		taskTitle: 'Add Postgres with migrations',
		complexityScore: 5,
		recommendedSubtasks: 4,
		reasoning: 'Two tables and a migration script.'
	},
	{
		taskId: 3,
		taskTitle: 'Email and password sign-in',
		complexityScore: 7,
		recommendedSubtasks: 6,
		expansionPrompt: 'A long prompt that the report should not print',
		reasoning: 'Password hashing, sessions and an auth guard.'
	},
	{
		taskId: 6,
		taskTitle: 'Write the README',
		complexityScore: 2,
		recommendedSubtasks: 0,
		reasoning: 'Documentation only.'
	}
];

describe('formatComplexityRun', () => {
	it('lists each task by score, then where the report went and what next', () => {
		const output = plain(
			formatComplexityRun(
				{
					analyses,
					skipped: 1,
					kept: 0,
					reportPath: '.taskgraph/reports/task-complexity-report.json'
				},
				80
			)
		);

		expect(output.split('\n')).toEqual([
			'✓ Analyzed 3 tasks · skipped 1 done',
			'  3  Email and password sign-in    ● 7  6 subtasks',
			'  2  Add Postgres with migrations  ● 5  4 subtasks',
			'  6  Write the README              ● 2',
			'Saved to .taskgraph/reports/task-complexity-report.json',
			'Next: taskgraph expand --all, or analyze-complexity --report to see why'
		]);
	});

	it('says how many earlier analyses the report keeps', () => {
		const output = plain(
			formatComplexityRun(
				{ analyses, skipped: 0, kept: 2, reportPath: 'report.json' },
				80
			)
		);

		expect(output).toContain('Saved to report.json, with 2 earlier analyses');
	});

	it('leaves out placeholders, which are not scores (#634)', () => {
		const output = plain(
			formatComplexityRun(
				{
					analyses: [
						analyses[1],
						{
							taskId: 2,
							taskTitle: 'Add Postgres with migrations',
							complexityScore: 5,
							placeholder: true
						}
					],
					skipped: 0,
					kept: 1,
					reportPath: 'report.json'
				},
				80
			)
		);

		expect(output.split('\n').slice(0, 3)).toEqual([
			'✓ Analyzed 1 task',
			'  3  Email and password sign-in  ● 7  6 subtasks',
			'Saved to report.json, with 1 earlier analysis'
		]);
	});

	it('mentions web research when it was used', () => {
		const output = plain(
			formatComplexityRun(
				{
					analyses,
					skipped: 0,
					kept: 0,
					reportPath: 'report.json',
					usedResearch: true
				},
				80
			)
		);

		expect(output.split('\n')[0]).toBe(
			'✓ Analyzed 3 tasks · with web research'
		);
	});

	it('cuts titles so rows fit the terminal', () => {
		const output = plain(
			formatComplexityRun(
				{
					analyses: [
						{
							taskId: 1,
							taskTitle: 'A very long task title '.repeat(6),
							complexityScore: 8,
							recommendedSubtasks: 5
						}
					],
					skipped: 0,
					kept: 0,
					reportPath: 'report.json'
				},
				60
			)
		);

		expect(output.split('\n')[1].length).toBeLessThanOrEqual(60);
		expect(output).toContain('…');
	});

	it('says so when nothing was pending', () => {
		expect(
			plain(
				formatComplexityRun(
					{ analyses: [], skipped: 3, kept: 0, reportPath: 'report.json' },
					80
				)
			)
		).toBe('No pending tasks to analyze');
	});
});

describe('formatComplexityReport', () => {
	const report = {
		meta: { generatedAt: '2026-10-20T15:30:00.000Z', usedResearch: false },
		complexityAnalysis: analyses
	};

	it('counts levels with the same bands as the colored dots', () => {
		// A 7 is red everywhere, so it counts as High here too
		const header = plain(formatComplexityReport(report, 80)).split('\n')[1];

		expect(header).toMatch(/^3 tasks · High 1 · Medium 1 · Low 1 · /);
	});

	it('shows the reasoning under each task, highest score first', () => {
		const lines = plain(formatComplexityReport(report, 80)).split('\n');

		const first = lines.findIndex((line) =>
			line.includes('Email and password')
		);
		expect(lines[first + 1].trim()).toBe(
			'Password hashing, sessions and an auth guard.'
		);
		expect(first).toBeLessThan(
			lines.findIndex((line) => line.includes('Add Postgres'))
		);
	});

	it('leaves out the expansion prompt, which expand reads from the report', () => {
		const output = plain(formatComplexityReport(report, 80));

		expect(output).not.toContain('A long prompt');
		expect(output).toContain('taskgraph expand --id=<id> or --all');
	});

	it('wraps reasoning to the terminal width', () => {
		const long = {
			...report,
			complexityAnalysis: [
				{ ...analyses[0], reasoning: 'word '.repeat(60).trim() }
			]
		};

		const reasoning = plain(formatComplexityReport(long, 50))
			.split('\n')
			.filter((line) => line.startsWith('     word'));
		expect(reasoning.length).toBeGreaterThan(1);
		for (const line of reasoning) {
			expect(line.length).toBeLessThanOrEqual(50);
		}
	});
});
