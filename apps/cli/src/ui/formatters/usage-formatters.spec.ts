import { describe, expect, it } from 'vitest';
import { formatCost, formatUsageLine } from './usage-formatters.js';

describe('formatUsageLine', () => {
	it('shows the model and token counts with thousands separators', () => {
		expect(
			formatUsageLine({
				modelUsed: 'sonnet',
				inputTokens: 108386,
				outputTokens: 12743,
				totalTokens: 121129,
				totalCost: 0
			})
		).toBe('sonnet · 121,129 tokens (108,386 in, 12,743 out)');
	});

	it('adds an estimated cost only when there is one', () => {
		expect(
			formatUsageLine({
				modelUsed: 'opus',
				inputTokens: 1000,
				outputTokens: 500,
				totalCost: 0.093549
			})
		).toBe('opus · 1,500 tokens (1,000 in, 500 out) · ~$0.0935');
		expect(
			formatUsageLine({
				inputTokens: 10,
				outputTokens: 5,
				totalCost: 3,
				isUnknownCost: true
			})
		).toBe('15 tokens (10 in, 5 out)');
	});

	it('names several models when a command used more than one', () => {
		expect(
			formatUsageLine({
				modelUsed: 'Multiple',
				inputTokens: 2,
				outputTokens: 1
			})
		).toBe('several models · 3 tokens (2 in, 1 out)');
	});

	it('shows nothing without usage', () => {
		expect(formatUsageLine(null)).toBeNull();
		expect(formatUsageLine({ modelUsed: 'sonnet', inputTokens: 0 })).toBeNull();
	});
});

describe('formatCost', () => {
	it('rounds to what is worth reading', () => {
		expect(formatCost(0.004)).toBe('<$0.01');
		expect(formatCost(0.093549)).toBe('$0.0935');
		expect(formatCost(1.2449)).toBe('$1.24');
		expect(formatCost(2, 'EUR')).toBe('EUR 2.00');
	});
});
