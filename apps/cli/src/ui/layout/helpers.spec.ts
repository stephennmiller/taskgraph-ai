/**
 * Layout helper utilities tests
 * Tests for apps/cli/src/utils/layout/helpers.ts
 */

import { describe, expect, it } from 'vitest';
import { getContentWidth, planColumns, terminalWidth } from './helpers.js';

describe('Layout Helpers', () => {
	describe('terminalWidth', () => {
		it('uses the terminal width when output is a terminal', () => {
			expect(terminalWidth({ columns: 132 }, { COLUMNS: '60' })).toBe(132);
		});

		// Regression for #184: piped output has no columns, so COLUMNS was ignored
		it('uses COLUMNS when output is piped', () => {
			expect(terminalWidth({}, { COLUMNS: '120' })).toBe(120);
			expect(terminalWidth({ columns: 0 }, { COLUMNS: ' 60 ' })).toBe(60);
		});

		it('caps COLUMNS so a huge value cannot crash the layout', () => {
			expect(terminalWidth({}, { COLUMNS: '9999999999' })).toBe(1000);
		});

		it('falls back to 80 when COLUMNS is unset or not a positive integer', () => {
			expect(terminalWidth({}, {})).toBe(80);
			for (const value of ['', '0', '-5', 'wide', '12.5', '80px']) {
				expect(terminalWidth({}, { COLUMNS: value })).toBe(80);
			}
		});
	});

	describe('getContentWidth', () => {
		it('takes 95% of the terminal width', () => {
			expect(getContentWidth({ columns: 100 }, {})).toBe(95);
		});

		it('takes 95% of COLUMNS when output is piped', () => {
			expect(getContentWidth({}, { COLUMNS: '60' })).toBe(57);
		});

		it('uses 100 columns when neither the terminal nor COLUMNS says', () => {
			expect(getContentWidth({}, {})).toBe(100);
			expect(getContentWidth({}, { COLUMNS: 'abc' })).toBe(100);
		});
	});

	describe('planColumns', () => {
		const specs = [
			{ key: 'id', width: 10 },
			{ key: 'title', width: 'flex' as const },
			{ key: 'status', width: 15 },
			{ key: 'deps', width: 14, dropOrder: 2 },
			{ key: 'blocks', width: 10, dropOrder: 0 },
			{ key: 'complexity', width: 12, dropOrder: 1 }
		];
		const totalOf = (widths: number[]) =>
			widths.reduce((a, b) => a + b, 0) + widths.length + 1;

		it('keeps every column and fills the width when there is room', () => {
			const plan = planColumns(120, specs);
			expect(plan.hidden).toEqual([]);
			expect(totalOf(plan.widths)).toBe(120);
		});

		it('hides optional columns in drop order until the table fits', () => {
			const plan = planColumns(76, specs);
			expect(plan.hidden).toEqual(['blocks', 'complexity']);
			expect(plan.keys).toEqual(['id', 'title', 'status', 'deps']);
			expect(totalOf(plan.widths)).toBe(76);
		});

		it('shrinks the flexible column below its minimum only once every optional column is hidden', () => {
			const plan = planColumns(40, specs);
			expect(plan.hidden).toEqual(['blocks', 'complexity', 'deps']);
			expect(totalOf(plan.widths)).toBe(40);
		});

		it('never shrinks the flexible column below 10', () => {
			const plan = planColumns(30, specs);
			expect(plan.widths[plan.keys.indexOf('title')]).toBe(10);
		});

		it('keeps display order for the columns it keeps', () => {
			const plan = planColumns(85, specs);
			expect(plan.keys).toEqual([
				'id',
				'title',
				'status',
				'deps',
				'complexity'
			]);
		});
	});
});
