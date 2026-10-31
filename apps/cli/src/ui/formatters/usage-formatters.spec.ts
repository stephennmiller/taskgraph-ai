import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatCost,
	formatLoopSpend,
	formatUsageLine
} from './usage-formatters.js';

describe('formatUsageLine', () => {
	it('shows the model and token counts with thousands separators', () => {
		expect(
			formatUsageLine(
				{
					modelUsed: 'sonnet',
					inputTokens: 108386,
					outputTokens: 12743,
					totalTokens: 121129,
					totalCost: 0
				},
				'en-US'
			)
		).toBe('sonnet · 121,129 tokens (108,386 in, 12,743 out)');
	});

	it('says how much of the input came from the prompt cache', () => {
		expect(
			formatUsageLine(
				{
					modelUsed: 'sonnet',
					inputTokens: 129733,
					outputTokens: 1472,
					cachedInputTokens: 118000
				},
				'en-US'
			)
		).toBe('sonnet · 131,205 tokens (129,733 in, 1,472 out) · 91% cached');
		expect(
			formatUsageLine(
				{ inputTokens: 1000, outputTokens: 1, cachedInputTokens: 5 },
				'en-US'
			)
		).toBe('1,001 tokens (1,000 in, 1 out)');
	});

	it('adds an estimated cost only when there is one', () => {
		expect(
			formatUsageLine(
				{
					modelUsed: 'opus',
					inputTokens: 1000,
					outputTokens: 500,
					totalCost: 0.093549
				},
				'en-US'
			)
		).toBe('opus · 1,500 tokens (1,000 in, 500 out) · ~$0.0935');
		expect(
			formatUsageLine(
				{
					inputTokens: 10,
					outputTokens: 5,
					totalCost: 3,
					isUnknownCost: true
				},
				'en-US'
			)
		).toBe('15 tokens (10 in, 5 out)');
	});

	it('names several models when a command used more than one', () => {
		expect(
			formatUsageLine(
				{
					modelUsed: 'Multiple',
					inputTokens: 2,
					outputTokens: 1
				},
				'en-US'
			)
		).toBe('several models · 3 tokens (2 in, 1 out)');
	});

	it('shows nothing without usage', () => {
		expect(formatUsageLine(null)).toBeNull();
		expect(
			formatUsageLine({ modelUsed: 'sonnet', inputTokens: 0 }, 'en-US')
		).toBeNull();
	});
});

describe('formatCost', () => {
	it('rounds to what is worth reading', () => {
		expect(formatCost(0.004, 'USD', 'en-US')).toBe('<$0.01');
		expect(formatCost(0.093549, 'USD', 'en-US')).toBe('$0.0935');
		expect(formatCost(1.2449, 'USD', 'en-US')).toBe('$1.24');
		expect(formatCost(2, 'EUR', 'en-US')).toBe('€2.00');
	});

	it("follows the reader's locale", () => {
		expect(
			formatUsageLine(
				{ modelUsed: 'sonnet', inputTokens: 121000, outputTokens: 129 },
				'de-DE'
			)
		).toBe('sonnet · 121.129 tokens (121.000 in, 129 out)');
		expect(formatCost(1.5, 'EUR', 'de-DE')).toBe('1,50\u00a0€');
	});
});

describe('formatLoopSpend', () => {
	it('lists cost, turns and time after a separator', () => {
		expect(
			stripVTControlCharacters(
				formatLoopSpend({ costUsd: 1.5, turns: 1, durationMs: 190_000 })
			)
		).toBe(' · $1.50 · 1 turn · 3m 10s');
	});

	it("leaves out what Claude Code didn't report, and is empty for nothing", () => {
		expect(stripVTControlCharacters(formatLoopSpend({ turns: 4 }))).toBe(
			' · 4 turns'
		);
		expect(formatLoopSpend({})).toBe('');
	});

	it('leads with the model and effort the iteration ran at', () => {
		expect(
			stripVTControlCharacters(
				formatLoopSpend({ model: 'sonnet', effort: 'low', turns: 3 })
			)
		).toBe(' · sonnet, low effort · 3 turns');
		expect(stripVTControlCharacters(formatLoopSpend({ effort: 'high' }))).toBe(
			' · high effort'
		);
	});

	it('says first whether the iteration resumed the last session', () => {
		expect(
			stripVTControlCharacters(
				formatLoopSpend({ session: 'resumed', model: 'sonnet', turns: 3 })
			)
		).toBe(' · resumed · sonnet · 3 turns');
	});
});
