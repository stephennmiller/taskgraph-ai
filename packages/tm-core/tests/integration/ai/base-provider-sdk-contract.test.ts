/**
 * Contract test: runs BaseAIProvider through the REAL `ai` package (no module
 * mock) against a mock language model, so SDK upgrades that rename or drop
 * options fail here instead of silently at runtime.
 */
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseAIProvider } from '../../../src/modules/ai/providers/base-provider.js';

const usage = {
	inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 7, text: 7, reasoning: 0 }
};

const makeModel = (text: string, calls: any[]) =>
	new MockLanguageModelV4({
		doGenerate: async (options: any) => {
			calls.push(options);
			return {
				content: [{ type: 'text', text }],
				finishReason: { unified: 'stop', raw: 'stop' },
				usage,
				warnings: []
			};
		}
	});

class ContractProvider extends BaseAIProvider {
	constructor(private readonly model: MockLanguageModelV4) {
		super(vi.fn());
	}
	getClient() {
		return () => this.model;
	}
	isRequiredApiKey() {
		return false;
	}
	validateAuth() {}
}

const params = (extra: Record<string, unknown> = {}) => ({
	modelId: 'mock-model',
	maxTokens: 321,
	temperature: 0.2,
	messages: [
		{ role: 'system', content: 'You are terse.' },
		{ role: 'user', content: 'hello' }
	],
	...extra
});

describe('BaseAIProvider against the real AI SDK', () => {
	it('generateText returns text and normalized usage', async () => {
		const calls: any[] = [];
		const provider = new ContractProvider(makeModel('hi there', calls));

		const result = await provider.generateText(params());

		expect(result.text).toBe('hi there');
		expect(result.usage).toEqual({
			inputTokens: 11,
			outputTokens: 7,
			totalTokens: 18,
			cachedInputTokens: 0
		});
		expect(calls[0].prompt[0]).toMatchObject({
			role: 'system',
			content: 'You are terse.'
		});
		expect(calls[0].maxOutputTokens).toBe(321);
		expect(calls[0].temperature).toBe(0.2);
	});

	it('reports input read from the prompt cache', async () => {
		const cachedModel = new MockLanguageModelV4({
			doGenerate: async () => ({
				content: [{ type: 'text', text: 'ok' }],
				finishReason: { unified: 'stop', raw: 'stop' },
				usage: {
					inputTokens: {
						total: 1000,
						noCache: 100,
						cacheRead: 900,
						cacheWrite: 0
					},
					outputTokens: { total: 5, text: 5, reasoning: 0 }
				},
				warnings: []
			})
		});
		const provider = new ContractProvider(cachedModel);

		const result = await provider.generateText(params());

		expect(result.usage).toMatchObject({
			inputTokens: 1000,
			cachedInputTokens: 900
		});
	});

	it('generateObject returns a parsed object and normalized usage', async () => {
		const calls: any[] = [];
		const provider = new ContractProvider(
			makeModel(JSON.stringify({ title: 'Ship it' }), calls)
		);

		const result = await provider.generateObject(
			params({
				schema: z.object({ title: z.string() }),
				objectName: 'task'
			})
		);

		expect(result.object).toEqual({ title: 'Ship it' });
		expect(result.usage.totalTokens).toBe(18);
		expect(calls[0].responseFormat?.type).toBe('json');
	});

	it('generateObject repairs malformed JSON via jsonrepair', async () => {
		const calls: any[] = [];
		const provider = new ContractProvider(
			makeModel("{title: 'Ship it',}", calls)
		);

		const result = await provider.generateObject(
			params({
				schema: z.object({ title: z.string() }),
				objectName: 'task'
			})
		);

		expect(result.object).toEqual({ title: 'Ship it' });
	});
});
