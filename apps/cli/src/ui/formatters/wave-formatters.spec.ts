import type { ParallelWaves } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatWaveSummary } from './wave-formatters.js';

const plain = (s: string | null) => s?.replace(/\x1b\[[0-9;]*m/g, '') ?? null;

const waves = (
	list: string[][],
	unscheduled: ParallelWaves['unscheduled'] = []
): ParallelWaves => ({
	waves: list,
	waveOf: Object.fromEntries(
		list.flatMap((ids, i) => ids.map((id) => [id, i + 1]))
	),
	unscheduled
});

describe('formatWaveSummary', () => {
	it('counts the waves and names what can run now', () => {
		const line = formatWaveSummary(waves([['2', '3', '4', '9'], ['5'], ['6']]));

		expect(plain(line)).toBe('3 waves · 4 tasks can run now: 2, 3, 4, 9');
	});

	it('uses the singular for one wave and one task', () => {
		expect(plain(formatWaveSummary(waves([['7']])))).toBe(
			'1 wave · 1 task can run now: 7'
		);
	});

	it('counts the tasks that cannot be scheduled', () => {
		const line = formatWaveSummary(
			waves(
				[['5']],
				[
					{ id: '2', reason: 'cycle', blockers: ['3'] },
					{ id: '3', reason: 'cycle', blockers: ['2'] }
				]
			)
		);

		expect(plain(line)).toBe(
			"1 wave · 1 task can run now: 5 · 2 can't be scheduled"
		);
	});

	it('says nothing can run when every open task is stuck', () => {
		const line = formatWaveSummary(
			waves([], [{ id: '1', reason: 'missing', blockers: ['99'] }])
		);

		expect(plain(line)).toBe("Nothing can run now · 1 can't be scheduled");
	});

	it('returns null when there is no unfinished work', () => {
		expect(formatWaveSummary(waves([]))).toBeNull();
	});

	it('fits 80 columns by cutting the ID list with an ellipsis', () => {
		const ready = Array.from({ length: 60 }, (_, i) => String(i + 1));
		const line = plain(
			formatWaveSummary(
				waves([ready], [{ id: '99', reason: 'held', blockers: [] }]),
				80
			)
		) as string;

		expect(line.length).toBeLessThanOrEqual(80);
		expect(line).toMatch(
			/^1 wave · 60 tasks can run now: 1, 2, 3, .*, … · 1 can't be scheduled$/
		);
	});
});
