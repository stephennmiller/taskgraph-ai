/**
 * @fileoverview A task's loop spend only grows, so the merge adds both
 * branches' additions instead of reporting a clash
 */

import { describe, expect, it } from 'vitest';
import { mergeTasksJson } from './merge-tasks-json.js';

type Json = Record<string, any>;

const task = (id: number, extra: Json = {}): Json => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies: [],
	subtasks: [],
	...extra
});

const spend = (usd: number, durationMs: number, iterations: number) => ({
	spend: { usd, durationMs, iterations }
});

const file = (tasks: Json[]): Json => ({ master: { tasks, metadata: {} } });

const spendOf = (merged: unknown, id: number) =>
	(merged as Json).master.tasks.find((t: Json) => t.id === id)?.spend;

describe('mergeTasksJson with loop spend', () => {
	it("adds both sides' spend on a task instead of clashing", () => {
		const base = file([task(1, spend(1, 100, 1)), task(2)]);
		const ours = file([
			task(1, spend(1.5, 150, 2)),
			task(2, spend(0.2, 20, 1))
		]);
		const theirs = file([
			task(1, spend(1.25, 300, 3)),
			task(2, spend(0.3, 30, 1))
		]);

		const result = mergeTasksJson(base, ours, theirs);

		expect(result.conflicts).toEqual([]);
		expect(spendOf(result.merged, 1)).toEqual({
			usd: 1.75,
			durationMs: 350,
			iterations: 4
		});
		// Both added one iteration: two in all
		expect(spendOf(result.merged, 2)).toEqual({
			usd: 0.5,
			durationMs: 50,
			iterations: 2
		});
	});
});
