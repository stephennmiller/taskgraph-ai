/**
 * @fileoverview A task's loop spend merges like any other field. Summing
 * both sides would count it twice after a squash merge or a stack rebase,
 * where both sides hold the same runs.
 */

import { describe, expect, it } from 'vitest';
import { mergeTasksJson } from './merge-tasks-json.js';

type Json = Record<string, any>;

const spend = (n: number) => ({ usd: n, durationMs: n * 1000, iterations: n });

const file = (s?: Json): Json => ({
	master: {
		tasks: [
			{
				id: 1,
				title: 'Task 1',
				status: 'pending',
				dependencies: [],
				subtasks: [],
				...(s ? { spend: s } : {})
			}
		],
		metadata: {}
	}
});

const spendOf = (merged: unknown) => (merged as Json).master.tasks[0].spend;

describe('mergeTasksJson with loop spend', () => {
	it('takes the side that ran loop when only one did', () => {
		const result = mergeTasksJson(
			file(spend(1)),
			file(spend(3)),
			file(spend(1))
		);

		expect(result.conflicts).toEqual([]);
		expect(spendOf(result.merged)).toEqual(spend(3));
	});

	it("doesn't count a squash-merged branch's runs twice when main is merged back into it", () => {
		// The branch ran 3 iterations, was squash-merged, then ran a 4th
		const result = mergeTasksJson(file(), file(spend(4)), file(spend(3)));

		expect(spendOf(result.merged)).toEqual(spend(4));
		expect(result.conflicts.map((c) => c.field).sort()).toEqual([
			'spend.durationMs',
			'spend.iterations',
			'spend.usd'
		]);
	});

	it("doesn't count a replayed commit twice when a stack is rebased onto the squash", () => {
		// Main has the parent branch's 3 iterations squashed; its first commit (1) replays
		const result = mergeTasksJson(file(), file(spend(3)), file(spend(1)));

		expect(spendOf(result.merged)).toEqual(spend(3));
		expect(result.conflicts).toHaveLength(3);
	});
});
