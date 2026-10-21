/**
 * Every AI call gets a time limit, and the output-token limit reaches the
 * SDK under the name it reads (maxOutputTokens) for object calls too.
 */
import { vi } from 'vitest';

const sdk = vi.hoisted(() => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
	streamObject: vi.fn()
}));

vi.doMock('ai', () => ({
	...sdk,
	zodSchema: vi.fn((schema) => schema),
	jsonSchema: undefined,
	NoObjectGeneratedError: class extends Error {
		static isInstance() {
			return false;
		}
	},
	JSONParseError: class extends Error {}
}));
vi.doMock('jsonrepair', () => ({ jsonrepair: vi.fn() }));
vi.doMock('../../../scripts/modules/utils.js', () => ({
	log: vi.fn(),
	findProjectRoot: vi.fn(() => '/mock/project/root'),
	isEmpty: vi.fn(() => false),
	resolveEnvVariable: vi.fn((key) => process.env[key])
}));

const { BaseAIProvider } = await import(
	'../../../src/ai-providers/base-provider.js'
);

class TestProvider extends BaseAIProvider {
	constructor() {
		super();
		this.name = 'TestProvider';
	}
	getRequiredApiKeyName() {
		return 'TEST_API_KEY';
	}
	async getClient() {
		return (modelId) => ({ modelId });
	}
}

const base = {
	apiKey: 'key',
	modelId: 'model',
	messages: [{ role: 'user', content: 'hi' }],
	maxTokens: 1000
};
const objectParams = {
	...base,
	schema: { type: 'object' },
	objectName: 'Thing'
};

describe('AI call limits', () => {
	let provider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new TestProvider();
		sdk.generateText.mockResolvedValue({ text: 'x', usage: {} });
		sdk.generateObject.mockResolvedValue({ object: {}, usage: {} });
		sdk.streamText.mockReturnValue({});
		sdk.streamObject.mockReturnValue({});
	});

	const calls = [
		['generateText', () => provider.generateText(base)],
		['streamText', () => provider.streamText(base)],
		['generateObject', () => provider.generateObject(objectParams)],
		['streamObject', () => provider.streamObject(objectParams)]
	];

	test.each(calls)(
		'%s can be abandoned after a time limit',
		async (name, run) => {
			await run();

			const options = sdk[name].mock.calls[0][0];
			expect(options.abortSignal).toBeInstanceOf(AbortSignal);
			expect(options.abortSignal.aborted).toBe(false);
		}
	);

	test.each([['generateObject'], ['streamObject']])(
		'%s passes the token limit as maxOutputTokens',
		async (name) => {
			await calls.find(([n]) => n === name)[1]();

			const options = sdk[name].mock.calls[0][0];
			expect(options.maxOutputTokens).toBe(1000);
			expect(options).not.toHaveProperty('maxTokens');
		}
	);
});
