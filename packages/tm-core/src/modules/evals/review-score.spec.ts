import { describe, expect, it } from 'vitest';
import {
	type KnownBug,
	type ReviewCaseResult,
	parseReviewFindings,
	scoreReviewFindings,
	summarizeReviewRun
} from './review-score.js';

const bug: KnownBug = {
	file: 'src/a.ts',
	lines: [40, 200],
	fixedBy: 2,
	bug: 'cache version not bumped'
};

const result = (overrides: Partial<ReviewCaseResult>): ReviewCaseResult => ({
	id: 'x',
	pr: 1,
	bugs: 0,
	caught: [],
	findings: [],
	unmatched: 0,
	seconds: 10,
	costUsd: 0.5,
	...overrides
});

describe('parseReviewFindings', () => {
	it('reads FINDING lines, with list markers, backticks and diff prefixes', () => {
		const reply = [
			'Two issues.',
			'FINDING src/a.ts:41 stale cache: the version stayed at 2',
			'- `FINDING b/src/b.ts:7 exit code: exits 0 on failure`',
			'A FINDING mentioned mid-sentence is not one.'
		].join('\n');

		expect(parseReviewFindings(reply)).toEqual([
			{
				file: 'src/a.ts',
				line: 41,
				text: 'stale cache: the version stayed at 2'
			},
			{ file: 'src/b.ts', line: 7, text: 'exit code: exits 0 on failure' }
		]);
	});

	it('reads none from NO FINDINGS', () => {
		expect(parseReviewFindings('NO FINDINGS')).toEqual([]);
	});
});

describe('scoreReviewFindings', () => {
	it('counts a finding within 5 lines of any of the bug lines as a catch', () => {
		const score = scoreReviewFindings(
			[bug],
			[
				{ file: 'src/a.ts', line: 196, text: '' },
				{ file: 'src/a.ts', line: 120, text: '' },
				{ file: 'src/other.ts', line: 40, text: '' }
			]
		);

		expect(score).toEqual({ caught: [bug.bug], unmatched: 2 });
	});

	it('misses a finding 6 lines away', () => {
		expect(
			scoreReviewFindings([bug], [{ file: 'src/a.ts', line: 46, text: '' }])
		).toEqual({ caught: [], unmatched: 1 });
	});
});

describe('summarizeReviewRun', () => {
	it('splits noise into clean-PR and other findings and skips failed cases', () => {
		const summary = summarizeReviewRun([
			result({ id: 'a', bugs: 2, caught: ['x'], unmatched: 1 }),
			result({ id: 'b', bugs: 0, unmatched: 3 }),
			result({ id: 'c', bugs: 1, error: 'claude exited 1' })
		]);

		expect(summary).toMatchObject({
			recall: 0.5,
			caught: 1,
			bugs: 2,
			cleanFindings: 3,
			otherFindings: 1,
			failed: 1,
			seconds: 30,
			costUsd: 1.5
		});
	});

	it('has no recall when no buggy case ran', () => {
		expect(summarizeReviewRun([result({})]).recall).toBeNull();
	});
});
