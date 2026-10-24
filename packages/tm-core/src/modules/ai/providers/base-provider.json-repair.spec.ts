import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { BaseAIProvider } from './base-provider.js';

const sdk = vi.hoisted(() => {
	class NoObjectGeneratedError extends Error {
		static isInstance(error: unknown) {
			return error instanceof NoObjectGeneratedError;
		}
		usage: unknown;
		constructor(public cause: any) {
			super('No object generated');
			this.usage = cause.usage;
		}
	}
	class JSONParseError extends Error {
		constructor(public text: string) {
			super('JSON parse error');
		}
	}
	return {
		generateObject: vi.fn(),
		jsonrepair: vi.fn(),
		NoObjectGeneratedError,
		JSONParseError
	};
});
const mockGenerateObject = sdk.generateObject;
const mockJsonrepair = sdk.jsonrepair;
const mockNoObjectGeneratedError = sdk.NoObjectGeneratedError;
const mockJSONParseError = sdk.JSONParseError;

vi.mock('ai', () => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: sdk.generateObject,
	streamObject: vi.fn(),
	zodSchema: vi.fn((schema) => schema),
	// Vitest throws on access to an undefined mock export
	jsonSchema: undefined,
	NoObjectGeneratedError: sdk.NoObjectGeneratedError,
	JSONParseError: sdk.JSONParseError
}));
vi.mock('jsonrepair', () => ({ jsonrepair: sdk.jsonrepair }));

class TestProvider extends BaseAIProvider {
	constructor() {
		super(vi.fn());
		this.name = 'TestProvider';
	}
	getRequiredApiKeyName() {
		return 'TEST_API_KEY';
	}
	async getClient(): Promise<any> {
		return vi.fn((modelId: string) => ({ modelId }));
	}
}

let testProvider: any;
beforeEach(() => {
	vi.clearAllMocks();
	testProvider = new TestProvider();
});

describe('BaseAIProvider JSON repair for malformed responses', () => {
	it('should repair malformed JSON in generateObject errors', async () => {
		const malformedJson = '{"key": "value",,}'; // Double comma
		const repairedJson = '{"key": "value"}';

		const parseError = new mockJSONParseError(malformedJson);
		const noObjectError = new mockNoObjectGeneratedError(parseError);
		(noObjectError as any).usage = {
			promptTokens: 100,
			completionTokens: 50,
			totalTokens: 150
		};

		mockGenerateObject.mockRejectedValue(noObjectError);
		mockJsonrepair.mockReturnValue(repairedJson);

		const result = await testProvider.generateObject({
			apiKey: 'key',
			modelId: 'model',
			messages: [{ role: 'user', content: 'test' }],
			schema: z.object({ key: z.string() }),
			objectName: 'TestObject'
		});

		expect(mockJsonrepair).toHaveBeenCalledWith(malformedJson);
		expect(result).toEqual({
			object: { key: 'value' },
			usage: {
				inputTokens: 100,
				outputTokens: 50,
				totalTokens: 150
			}
		});
	});

	it('rejects repaired JSON that does not match the schema', async () => {
		// A truncated reply repairs into valid JSON with a field missing
		const truncated = '{"title": "Task one", "priority": ';
		mockGenerateObject.mockRejectedValue(
			new mockNoObjectGeneratedError(new mockJSONParseError(truncated))
		);
		mockJsonrepair.mockReturnValue('{"title": "Task one", "priority": null}');

		await expect(
			testProvider.generateObject({
				apiKey: 'key',
				modelId: 'model',
				messages: [{ role: 'user', content: 'test' }],
				schema: z.object({ title: z.string(), priority: z.string() }),
				objectName: 'Task'
			})
		).rejects.toThrow(
			/repaired Task JSON does not match the schema \(priority: /
		);
	});

	it('should throw original error when JSON repair fails', async () => {
		const malformedJson = 'not even close to JSON';
		const parseError = new mockJSONParseError(malformedJson);
		const noObjectError = new mockNoObjectGeneratedError(parseError);

		mockGenerateObject.mockRejectedValue(noObjectError);
		mockJsonrepair.mockImplementation(() => {
			throw new Error('Cannot repair this JSON');
		});

		await expect(
			testProvider.generateObject({
				apiKey: 'key',
				modelId: 'model',
				messages: [{ role: 'user', content: 'test' }],
				schema: { type: 'object' },
				objectName: 'TestObject'
			})
		).rejects.toThrow('TestProvider API error during object generation');
	});

	it('should handle non-JSON parse errors normally', async () => {
		const regularError = new Error('Network timeout');
		mockGenerateObject.mockRejectedValue(regularError);

		await expect(
			testProvider.generateObject({
				apiKey: 'key',
				modelId: 'model',
				messages: [{ role: 'user', content: 'test' }],
				schema: { type: 'object' },
				objectName: 'TestObject'
			})
		).rejects.toThrow(
			'TestProvider API error during object generation: Network timeout'
		);

		expect(mockJsonrepair).not.toHaveBeenCalled();
	});
});
