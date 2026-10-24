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

// Mock CLI failure scenario
vi.mock('ai-sdk-provider-claude-code', () => ({
	createClaudeCode: vi.fn(() => {
		throw new Error('Claude Code CLI not found');
	})
}));

describe('Claude Code Error Handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('should throw a CLI-not-available error (with or without commandName)', async () => {
		const provider = new ClaudeCodeProvider(providerOptions());
		await expect(provider.getClient()).rejects.toThrow(
			/Claude Code CLI not available/i
		);
		await expect(provider.getClient({ commandName: 'test' })).rejects.toThrow(
			/Claude Code CLI not available/i
		);
	});

	it('says to reinstall, not to install the CLI, when a package is missing', async () => {
		vi.mocked(createClaudeCode).mockImplementationOnce(() => {
			throw Object.assign(
				new Error("Cannot find package 'ai-sdk-provider-claude-code'"),
				{ code: 'ERR_MODULE_NOT_FOUND' }
			);
		});
		const provider = new ClaudeCodeProvider(providerOptions());

		const result = provider.getClient();

		await expect(result).rejects.toThrow(/reinstall TaskGraph/);
		await expect(result).rejects.not.toThrow(/CLI not available/);
	});

	it('should still support basic provider functionality', () => {
		const provider = new ClaudeCodeProvider(providerOptions());

		// These should work even if CLI is not available
		expect(provider.name).toBe('Claude Code');
		expect(provider.getSupportedModels()).toEqual(['opus', 'sonnet', 'haiku']);
		expect(provider.isModelSupported('sonnet')).toBe(true);
		expect(provider.isModelSupported('haiku')).toBe(true);
		expect(provider.isRequiredApiKey()).toBe(false);
		expect(() => provider.validateAuth()).not.toThrow();
	});
});
