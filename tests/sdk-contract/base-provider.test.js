/**
 * Contract test: runs BaseAIProvider through the REAL `ai` package (no module
 * mock) against a mock language model, so SDK upgrades that rename or drop
 * options fail here instead of silently at runtime.
 */
import { jest } from '@jest/globals';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';

// Runs in its own jest process (`npm run test:sdk-contract`): the real SDK stack
// leaves process-level state that breaks unrelated suites sharing a worker.
//
// Only app-side modules are mocked: utils (as in base-provider.test.js) and
// Sentry telemetry. Running the real telemetry code leaves process-level state
// that breaks later suites in the same jest worker (signal-exit errors). The
// `ai` package itself stays real.
jest.unstable_mockModule('../../scripts/modules/utils.js', () => ({
	log: jest.fn(),
	findProjectRoot: jest.fn(() => '/mock/project/root'),
	isEmpty: jest.fn(
		(val) =>
			!val ||
			(Array.isArray(val) && val.length === 0) ||
			(typeof val === 'object' && Object.keys(val).length === 0)
	),
	resolveEnvVariable: jest.fn((key) => process.env[key])
}));

jest.unstable_mockModule('../../src/telemetry/sentry.js', () => ({
	hashProjectRoot: jest.fn(() => 'hash'),
	getAITelemetryConfig: jest.fn(() => undefined)
}));

const { AzureProvider } = await import('../../src/ai-providers/azure.js');
const { BaseAIProvider } = await import(
	'../../src/ai-providers/base-provider.js'
);

const usage = {
	inputTokens: { total: 11, noCache: 11, cacheRead: 0, cacheWrite: 0 },
	outputTokens: { total: 7, text: 7, reasoning: 0 }
};

const makeModel = (text, calls) =>
	new MockLanguageModelV4({
		doGenerate: async (options) => {
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
	constructor(model) {
		super();
		this.model = model;
	}
	getClient() {
		return () => this.model;
	}
	isRequiredApiKey() {
		return false;
	}
	validateAuth() {}
}

const params = (extra = {}) => ({
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
		const calls = [];
		const provider = new ContractProvider(makeModel('hi there', calls));

		const result = await provider.generateText(params());

		expect(result.text).toBe('hi there');
		expect(result.usage).toEqual({
			inputTokens: 11,
			outputTokens: 7,
			totalTokens: 18
		});
		expect(calls[0].prompt[0]).toMatchObject({
			role: 'system',
			content: 'You are terse.'
		});
		expect(calls[0].maxOutputTokens).toBe(321);
		expect(calls[0].temperature).toBe(0.2);
	});

	it('generateObject returns a parsed object and normalized usage', async () => {
		const calls = [];
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
		const calls = [];
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

describe('AzureProvider against the real AI SDK', () => {
	it('keeps using the Chat Completions API (AI SDK 7 defaults to Responses)', () => {
		const client = new AzureProvider().getClient({
			apiKey: 'test-key',
			baseURL: 'https://example.openai.azure.com/openai'
		});

		expect(client('my-deployment').provider).toBe('azure.chat');
	});
});
