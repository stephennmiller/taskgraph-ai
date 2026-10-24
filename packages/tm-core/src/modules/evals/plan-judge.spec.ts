import { describe, expect, it } from 'vitest';
import {
	type JudgeVerdict,
	PLAN_JUDGE_RUBRIC,
	buildJudgePrompt,
	judgeModelMismatch,
	planForJudge,
	scoreJudgeVerdict
} from './plan-judge.js';

const verdict = (grade: (id: string) => number): JudgeVerdict => ({
	grades: PLAN_JUDGE_RUBRIC.map((c) => ({
		id: c.id,
		grade: grade(c.id),
		reason: 'because'
	})),
	summary: 'Fine plan.'
});

describe('scoreJudgeVerdict', () => {
	it('maps the mean grade to 0..1', () => {
		expect(scoreJudgeVerdict(verdict(() => 5))?.score).toBe(1);
		expect(scoreJudgeVerdict(verdict(() => 1))?.score).toBe(0);
		expect(scoreJudgeVerdict(verdict(() => 3))?.score).toBe(0.5);
	});

	it('keeps each grade and the summary', () => {
		const score = scoreJudgeVerdict(
			verdict((id) => (id === 'ordering' ? 2 : 4))
		);

		expect(score?.grades.ordering).toBe(2);
		expect(score?.grades.coverage).toBe(4);
		expect(score?.summary).toBe('Fine plan.');
	});

	it('clamps grades outside the rubric range', () => {
		const score = scoreJudgeVerdict(verdict((id) => (id === 'sizing' ? 9 : 5)));

		expect(score?.grades.sizing).toBe(5);
		expect(score?.score).toBe(1);
	});

	it('rejects a verdict that skips, repeats or invents a criterion', () => {
		const full = verdict(() => 4);
		const skipped = { ...full, grades: full.grades.slice(1) };
		const repeated = {
			...full,
			grades: [...full.grades.slice(1), full.grades[1]]
		};
		const invented = {
			...full,
			grades: [...full.grades.slice(1), { id: 'vibes', grade: 5, reason: '' }]
		};

		expect(scoreJudgeVerdict(skipped)).toBeNull();
		expect(scoreJudgeVerdict(repeated)).toBeNull();
		expect(scoreJudgeVerdict(invented)).toBeNull();
	});
});

describe('buildJudgePrompt', () => {
	it('carries the rubric, the PRD and the plan', () => {
		const { prompt, systemPrompt } = buildJudgePrompt('# Bookmarks PRD', [
			{ id: 1, title: 'Set up', subtasks: [{ id: 1, title: 'Scaffold' }] }
		]);

		for (const c of PLAN_JUDGE_RUBRIC) expect(prompt).toContain(`- ${c.id}:`);
		expect(prompt).toContain('# Bookmarks PRD');
		expect(prompt).toContain('"id": "1.1"');
		expect(systemPrompt).toContain('1 (poor) to 5 (excellent)');
	});
});

describe('planForJudge', () => {
	it('reads criteria in both stored formats', () => {
		const [task] = planForJudge([
			{
				id: 2,
				acceptanceCriteria: ['Works', { text: 'Tested', checked: true }, '']
			}
		]) as Array<{ acceptanceCriteria: string[] }>;

		expect(task.acceptanceCriteria).toEqual(['Works', 'Tested']);
	});

	it("gives the judge each subtask's details, test strategy and criteria", () => {
		const [task] = planForJudge([
			{
				id: 3,
				subtasks: [
					{
						id: 1,
						title: 'Add the route',
						details: 'GET /export returns CSV',
						testStrategy: 'Request it with supertest',
						acceptanceCriteria: ['Returns 200']
					}
				]
			}
		]) as Array<{ subtasks: unknown[] }>;

		expect(task.subtasks[0]).toMatchObject({
			id: '3.1',
			details: 'GET /export returns CSV',
			testStrategy: 'Request it with supertest',
			acceptanceCriteria: ['Returns 200']
		});
	});
});

describe('judgeModelMismatch', () => {
	const main = { provider: 'claude-code', modelId: 'sonnet' };

	it('accepts a verdict from the main model', () => {
		expect(
			judgeModelMismatch(
				{ providerName: 'claude-code', modelId: 'sonnet' },
				main
			)
		).toBeNull();
	});

	it('flags a verdict from a fallback model', () => {
		expect(
			judgeModelMismatch({ providerName: 'anthropic', modelId: 'opus' }, main)
		).toBe(
			"the judge ran on anthropic/opus, not the main model claude-code/sonnet, so its verdict can't be compared with the baseline"
		);
	});
});
