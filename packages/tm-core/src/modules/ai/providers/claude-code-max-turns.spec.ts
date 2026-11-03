import { createClaudeCode as mockedCreateClaudeCode } from 'ai-sdk-provider-claude-code';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ClaudeCodeProvider } from './claude-code.js';

// #936: a main or fallback call that spends its turns reading files is retried
// once without file tools instead of failing

const mockGenerateObject = vi.hoisted(() => vi.fn());
const mockGenerateText = vi.hoisted(() => vi.fn());

vi.mock('ai', () => ({
	generateObject: mockGenerateObject,
	generateText: mockGenerateText,
	streamText: vi.fn(),
	streamObject: vi.fn(),
	zodSchema: vi.fn((schema) => schema),
	// Vitest throws on access to an undefined mock export
	jsonSchema: undefined,
	JSONParseError: class JSONParseError extends Error {},
	NoObjectGeneratedError: class NoObjectGeneratedError extends Error {
		static isInstance(error: unknown) {
			return error instanceof NoObjectGeneratedError;
		}
	}
}));

vi.mock('ai-sdk-provider-claude-code', () => ({
	createClaudeCode: vi.fn(() => (modelId: string) => ({ modelId }))
}));

const createClaudeCode = mockedCreateClaudeCode as any;
const toolsOfCall = (n: number) =>
	createClaudeCode.mock.calls[n][0].defaultSettings.tools;
const maxTurns = new Error('Reached maximum number of turns (6)');
const call = {
	modelId: 'sonnet',
	messages: [{ role: 'user', content: 'Expand task 21' }],
	schema: z.object({ subtasks: z.array(z.string()) }),
	objectName: 'subtasks',
	role: 'main',
	projectRoot: '/work/project'
};

describe('ClaudeCodeProvider when a call runs out of turns', () => {
	let provider: ClaudeCodeProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new ClaudeCodeProvider({
			log: vi.fn(),
			getSettingsForCommand: () => ({}),
			supportedModels: ['sonnet']
		});
	});

	it('retries generateObject once without file tools', async () => {
		mockGenerateObject
			.mockRejectedValueOnce(maxTurns)
			.mockResolvedValueOnce({ object: { subtasks: ['a'] }, usage: {} });

		const result = await provider.generateObject(call);

		expect(result.object).toEqual({ subtasks: ['a'] });
		expect(mockGenerateObject).toHaveBeenCalledTimes(2);
		expect(toolsOfCall(0)).toEqual(['Read', 'Grep', 'Glob']);
		expect(toolsOfCall(1)).toEqual([]);
	});

	it('retries generateText the same way', async () => {
		mockGenerateText
			.mockRejectedValueOnce(maxTurns)
			.mockResolvedValueOnce({ text: 'done', usage: {} });

		const result = await provider.generateText(call);

		expect(result.text).toBe('done');
		expect(toolsOfCall(1)).toEqual([]);
	});

	it('gives up when the retry also runs out of turns', async () => {
		mockGenerateObject.mockRejectedValue(maxTurns);

		await expect(provider.generateObject(call)).rejects.toThrow(
			/maximum number of turns/
		);
		expect(mockGenerateObject).toHaveBeenCalledTimes(2);
	});

	it('does not retry other errors or the research role', async () => {
		mockGenerateObject.mockRejectedValueOnce(new Error('overloaded'));
		await expect(provider.generateObject(call)).rejects.toThrow(/overloaded/);

		mockGenerateObject.mockRejectedValueOnce(maxTurns);
		await expect(
			provider.generateObject({ ...call, role: 'research' })
		).rejects.toThrow(/maximum number of turns/);

		expect(mockGenerateObject).toHaveBeenCalledTimes(2);
	});
});
