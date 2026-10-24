import { generateText, streamText } from 'ai';
import { createClaudeCode } from 'ai-sdk-provider-claude-code';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from '../../../src/index.js';
import { providerOptions } from './provider-options.js';

// Mock AI SDK functions at the top level
vi.mock('ai', () => ({
	generateObject: vi.fn(),
	generateText: vi.fn(),
	streamText: vi.fn(),
	streamObject: vi.fn(),
	zodSchema: vi.fn(),
	// Vitest throws on access to an undefined mock export
	jsonSchema: undefined,
	JSONParseError: class JSONParseError extends Error {},
	NoObjectGeneratedError: class NoObjectGeneratedError extends Error {}
}));

// Mock successful provider creation for all tests
vi.mock('ai-sdk-provider-claude-code', () => {
	const mockProvider: any = vi.fn((modelId: string) => ({
		id: modelId,
		doGenerate: vi.fn(),
		doStream: vi.fn()
	}));
	mockProvider.languageModel = vi.fn((id, settings) => ({ id, settings }));
	mockProvider.chat = mockProvider.languageModel;
	return { createClaudeCode: vi.fn(() => mockProvider) };
});

const mockedGenerateText = vi.mocked(generateText) as any;
const mockedStreamText = vi.mocked(streamText) as any;

describe('Claude Code Integration (Optional)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should create a working provider instance', () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		expect(provider.name).toBe('Claude Code');
		expect(provider.getSupportedModels()).toEqual(['opus', 'sonnet', 'haiku']);
	});

	it('should support model validation', () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		expect(provider.isModelSupported('sonnet')).toBe(true);
		expect(provider.isModelSupported('opus')).toBe(true);
		expect(provider.isModelSupported('haiku')).toBe(true);
		expect(provider.isModelSupported('unknown')).toBe(false);
	});

	it('should create a client successfully', async () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		const client: any = await provider.getClient();

		expect(client).toBeDefined();
		expect(typeof client).toBe('function');
		expect(client.languageModel).toBeDefined();
		expect(client.chat).toBeDefined();
		expect(client.chat).toBe(client.languageModel);
	});

	it('should pass command-specific settings to client', async () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		const client = await provider.getClient({ commandName: 'test-command' });

		expect(client).toBeDefined();
		expect(typeof client).toBe('function');
		expect(createClaudeCode).toHaveBeenCalledTimes(1);
	});

	it('should handle AI SDK generateText integration', async () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		const client = await provider.getClient();

		// Mock successful generation
		mockedGenerateText.mockResolvedValueOnce({
			text: 'Hello from Claude Code!',
			usage: { totalTokens: 10 }
		});

		const result = await generateText({
			model: client('sonnet'),
			messages: [{ role: 'user', content: 'Hello' }]
		});

		expect(result.text).toBe('Hello from Claude Code!');
		expect(generateText).toHaveBeenCalledWith({
			model: expect.any(Object),
			messages: [{ role: 'user', content: 'Hello' }]
		});
	});

	it('should handle AI SDK streamText integration', async () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		const client = await provider.getClient();

		// Mock successful streaming
		const mockStream = {
			textStream: (async function* () {
				yield 'Streamed response';
			})()
		};
		mockedStreamText.mockResolvedValueOnce(mockStream);

		const streamResult = await streamText({
			model: client('sonnet'),
			messages: [{ role: 'user', content: 'Stream test' }]
		});

		expect(streamResult.textStream).toBeDefined();
		expect(streamText).toHaveBeenCalledWith({
			model: expect.any(Object),
			messages: [{ role: 'user', content: 'Stream test' }]
		});
	});

	it('should not require authentication validation', () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		expect(provider.isRequiredApiKey()).toBe(false);
		expect(() => provider.validateAuth()).not.toThrow();
		expect(() => provider.validateAuth({})).not.toThrow();
		expect(() => provider.validateAuth({ commandName: 'test' })).not.toThrow();
	});
});
