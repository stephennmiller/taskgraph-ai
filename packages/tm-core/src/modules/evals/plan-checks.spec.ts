import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	type PlanComplexity,
	type PlanTask,
	checkAcceptanceCriteria,
	checkDependencies,
	checkHeadingCoverage,
	checkPlan,
	checkSubtaskComplexity,
	checkTaskScaling,
	measurePrd,
	rankCorrelation
} from './plan-checks.js';

const FIXTURES = path.join(__dirname, '../../../tests/fixtures');
const prd = fs.readFileSync(path.join(FIXTURES, 'prd/bookmarks.md'), 'utf8');
const fixture = JSON.parse(
	fs.readFileSync(path.join(FIXTURES, 'evals/bookmarks-plan.json'), 'utf8')
) as { tasks: PlanTask[]; complexity: PlanComplexity[] };

/** A fresh copy of the fixture plan, safe to change in a test */
const plan = (): PlanTask[] => structuredClone(fixture.tasks);

describe('measurePrd', () => {
	it('counts words, not heading marks, and headings', () => {
		const size = measurePrd('# Title\n\nOne two three.\n\n## Part\n\nFour');
		expect(size).toEqual({ words: 6, sections: 2 });
	});
});

describe('checkHeadingCoverage', () => {
	it('lists the headings no task covers', () => {
		const result = checkHeadingCoverage(plan(), 'prd.md', prd);

		expect(result.uncovered).toEqual(['Rate limiting', 'Setup']);
		expect(result.sections).toBe(9);
		expect(result.score).toBeCloseTo(7 / 9);
		expect(result.unsourced).toEqual([]);
	});

	it('covers nothing when no task cites the PRD', () => {
		const tasks = plan().map(({ metadata: _, ...task }) => task);

		const result = checkHeadingCoverage(tasks, 'prd.md', prd);

		expect(result.score).toBe(0);
		expect(result.uncovered).toHaveLength(9);
		expect(result.unsourced).toEqual(['1', '2', '3', '4']);
	});

	it("doesn't ask for tasks for what not to build", () => {
		const content = [
			'# App',
			'## Login',
			'## Out of scope',
			'## Non-Goals',
			'## Open Questions',
			'## Clarifications'
		].join('\n\n');

		const result = checkHeadingCoverage(
			[{ id: 1, metadata: { source: 'prd.md#login' } }],
			'prd.md',
			content
		);

		expect(result).toMatchObject({ score: 1, sections: 2, uncovered: [] });
	});

	it('needs no task for headings inside a what-not-to-build section', () => {
		const content = [
			'# App',
			'## Login',
			'## Out-of-scope',
			'### Payments',
			'## Non-goals',
			'### Offline mode',
			'## Billing'
		].join('\n\n');

		const result = checkHeadingCoverage(
			[{ id: 1, metadata: { source: 'prd.md#login' } }],
			'prd.md',
			content
		);

		expect(result.uncovered).toEqual(['Billing']);
		expect(result.sections).toBe(3);
	});

	it('needs no task for top-level intro headings', () => {
		const content = [
			'# App',
			'## Overview',
			'## Summary',
			'## Background',
			'## Context',
			'## Introduction',
			'## Goals',
			'## Motivation',
			'## Problem',
			'## Login'
		].join('\n\n');

		const result = checkHeadingCoverage(
			[{ id: 1, metadata: { source: 'prd.md#login' } }],
			'prd.md',
			content
		);

		expect(result).toMatchObject({ score: 1, sections: 2, uncovered: [] });
	});

	it('still counts Users, Sources, Performance and nested intro headings', () => {
		const content = [
			'# App',
			'## Users',
			'## Sources',
			'## Performance',
			'### Overview',
			'## Login'
		].join('\n\n');

		const result = checkHeadingCoverage(
			[{ id: 1, metadata: { source: 'prd.md#login' } }],
			'prd.md',
			content
		);

		expect(result.uncovered).toEqual([
			'Users',
			'Sources',
			'Performance',
			'Overview'
		]);
		expect(result.sections).toBe(6);
	});

	it('reports tasks without a section', () => {
		const tasks = plan();
		delete tasks[3].metadata;

		const result = checkHeadingCoverage(tasks, 'prd.md', prd);

		expect(result.unsourced).toEqual(['4']);
		expect(result.uncovered).toContain('Search & Tags');
	});
});

describe('checkDependencies', () => {
	it('passes a plan whose dependencies all point back', () => {
		const result = checkDependencies(plan());

		expect(result).toEqual({ score: 1, edges: 9, cycles: [], invalid: [] });
	});

	it('flags missing, forward and self dependencies', () => {
		const tasks = plan();
		tasks[0].dependencies = [9];
		tasks[1].subtasks![0].dependencies = ['4'];
		tasks[1].subtasks![1].dependencies = [2];
		tasks[2].dependencies = [2, 4];
		tasks[3].dependencies = [];

		const result = checkDependencies(tasks);

		expect(result.cycles).toEqual([]);
		expect(result.invalid).toEqual([
			{ id: '1', dependency: '9', reason: 'missing' },
			{ id: '2.1', dependency: '4', reason: 'not-lower' },
			{ id: '2.2', dependency: '2.2', reason: 'self' },
			{ id: '3', dependency: '4', reason: 'not-lower' }
		]);
		expect(result.edges).toBe(10);
		expect(result.score).toBeCloseTo(0.6);
	});

	it('flags a subtask that waits on a later sibling', () => {
		const tasks = plan();
		tasks[2].subtasks![0].dependencies = [2];
		tasks[2].subtasks![1].dependencies = [];

		const result = checkDependencies(tasks);

		expect(result.invalid).toEqual([
			{ id: '3.1', dependency: '3.2', reason: 'not-lower' }
		]);
	});

	it('scores 0 when the plan has a cycle', () => {
		const tasks = plan();
		tasks[0].dependencies = [2];

		const result = checkDependencies(tasks);

		expect(result.cycles).toEqual([['1', '2']]);
		expect(result.score).toBe(0);
	});

	it('scores 1 with no dependencies at all', () => {
		expect(checkDependencies([{ id: 1 }, { id: 2 }]).score).toBe(1);
	});
});

describe('checkAcceptanceCriteria', () => {
	it('counts tasks and subtasks with criteria', () => {
		const tasks = plan();
		delete tasks[0].acceptanceCriteria;
		tasks[2].subtasks![1].acceptanceCriteria = ['  '];

		const result = checkAcceptanceCriteria(tasks);

		expect(result.items).toBe(12);
		expect(result.missing).toEqual(['1', '3.2']);
		expect(result.score).toBeCloseTo(10 / 12);
	});

	it('scores 0 for an empty plan', () => {
		expect(checkAcceptanceCriteria([]).score).toBe(0);
	});
});

describe('rankCorrelation', () => {
	it('is 1 for the same order and -1 for the reverse', () => {
		expect(rankCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
		expect(rankCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
	});

	it('gives ties their average rank', () => {
		expect(rankCorrelation([3, 7, 5, 2], [2, 3, 2, 1])).toBeCloseTo(
			4.5 / Math.sqrt(22.5)
		);
	});

	it('is null with too few pairs or no spread', () => {
		expect(rankCorrelation([1, 2], [1, 2])).toBeNull();
		expect(rankCorrelation([1, 2, 3], [5, 5, 5])).toBeNull();
		expect(rankCorrelation([1, 2, 3], [1, 2])).toBeNull();
	});
});

describe('checkSubtaskComplexity', () => {
	it('correlates complexity scores with subtask counts', () => {
		const result = checkSubtaskComplexity(plan(), fixture.complexity);

		expect(result.pairs).toEqual([
			{ taskId: '1', complexity: 3, subtasks: 2 },
			{ taskId: '2', complexity: 7, subtasks: 3 },
			{ taskId: '3', complexity: 5, subtasks: 2 },
			{ taskId: '4', complexity: 2, subtasks: 1 }
		]);
		expect(result.score).toBeCloseTo(4.5 / Math.sqrt(22.5));
	});

	it('scores 0 when the most complex task got the fewest subtasks', () => {
		const result = checkSubtaskComplexity(plan(), [
			{ taskId: 1, complexityScore: 2 },
			{ taskId: 2, complexityScore: 1 },
			{ taskId: 3, complexityScore: 3 },
			{ taskId: 4, complexityScore: 9 }
		]);

		expect(result.correlation).toBeLessThan(0);
		expect(result.score).toBe(0);
	});

	it('cannot score without a complexity report', () => {
		const result = checkSubtaskComplexity(plan(), []);

		expect(result).toEqual({ score: null, correlation: null, pairs: [] });
	});
});

describe('checkTaskScaling', () => {
	it('scores 1 when bigger PRDs got more tasks', () => {
		const result = checkTaskScaling([
			{ id: 'small', words: 200, taskCount: 4 },
			{ id: 'large', words: 2000, taskCount: 20 },
			{ id: 'medium', words: 800, taskCount: 9 }
		]);

		expect(result.score).toBeCloseTo(1);
	});

	it('scores 0 when task counts run against PRD size', () => {
		const result = checkTaskScaling([
			{ id: 'small', words: 200, taskCount: 20 },
			{ id: 'medium', words: 800, taskCount: 9 },
			{ id: 'large', words: 2000, taskCount: 4 }
		]);

		expect(result.score).toBe(0);
	});
});

describe('checkPlan', () => {
	it('averages the checks that can score', () => {
		const { checks, score } = checkPlan({
			tasks: plan(),
			prdPath: 'prd.md',
			prdContent: prd,
			complexity: []
		});

		expect(checks.subtaskComplexity.score).toBeNull();
		// coverage 7/9, dependencies 1, criteria 1
		expect(score).toBeCloseTo((7 / 9 + 2) / 3);
	});
});
