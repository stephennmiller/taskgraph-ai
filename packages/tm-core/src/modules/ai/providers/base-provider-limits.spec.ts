/**
 * Every AI call gets a time limit, and the output-token limit reaches the
 * SDK under the name it reads (maxOutputTokens) for object calls too.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { aiCallTimeoutMs, BaseAIProvider } from './base-provider.js';

const sdk: Record<string, any> = vi.hoisted(() => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
	streamObject: vi.fn()
}));

vi.mock('ai', () => ({
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
vi.mock('jsonrepair', () => ({ jsonrepair: vi.fn() }));

class TestProvider extends BaseAIProvider {
	constructor() {
		super(vi.fn());
		this.name = 'TestProvider';
	}
	getRequiredApiKeyName() {
		return 'TEST_API_KEY';
	}
	async getClient() {
		return (modelId: string) => ({ modelId }) as any;
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
	let provider: TestProvider;

	beforeEach(() => {
		vi.clearAllMocks();
		provider = new TestProvider();
		sdk.generateText.mockResolvedValue({ text: 'x', usage: {} });
		sdk.generateObject.mockResolvedValue({ object: {}, usage: {} });
		sdk.streamText.mockReturnValue({});
		sdk.streamObject.mockReturnValue({});
	});

	const calls: [string, () => Promise<unknown>][] = [
		['generateText', () => provider.generateText(base)],
		['streamText', () => provider.streamText(base)],
		['generateObject', () => provider.generateObject(objectParams)],
		['streamObject', () => provider.streamObject(objectParams)]
	];

	test.each(calls.filter(([name]) => !name.startsWith('stream')))(
		'%s can be abandoned after a time limit',
		async (name: string, run: () => Promise<unknown>) => {
			await run();

			const options = sdk[name].mock.calls[0][0];
			expect(options.abortSignal).toBeInstanceOf(AbortSignal);
			expect(options.abortSignal.aborted).toBe(false);
		}
	);

	describe('a call that runs past the limit (#653)', () => {
		// What the Claude Code provider throws when the signal fires
		const abortedByUser = ({ abortSignal }: { abortSignal: AbortSignal }) =>
			new Promise((_, reject) =>
				abortSignal.addEventListener('abort', () =>
					reject(new Error('Claude Code process aborted by user'))
				)
			);

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		test.each(calls.filter(([name]) => !name.startsWith('stream')))(
			'%s says it timed out and how to wait longer',
			async (name: string, run: () => Promise<unknown>) => {
				vi.stubEnv('TASKGRAPH_AI_TIMEOUT_MS', '20');
				sdk[name].mockImplementation(abortedByUser);

				const error = await run().catch((e: Error) => e);

				expect(error).toMatchObject({ name: 'TimeoutError' });
				expect((error as Error).message).toContain(
					'The AI call timed out after 0 seconds'
				);
				expect((error as Error).message).toContain('TASKGRAPH_AI_TIMEOUT_MS');
				expect((error as Error).message).not.toContain('aborted by user');
			}
		);

		test('an abort the limit did not cause keeps its own message', async () => {
			sdk.generateText.mockRejectedValue(
				new Error('Claude Code process aborted by user')
			);

			await expect(provider.generateText(base)).rejects.toThrow(
				'aborted by user'
			);
		});
	});

	test.each([['streamText'], ['streamObject']])(
		'%s is not cut off, since it runs as long as the model writes',
		async (name) => {
			await calls.find(([n]) => n === name)?.[1]();

			expect(sdk[name].mock.calls[0][0].abortSignal).toBeUndefined();
		}
	);

	test("streamObject passes the caller's abort signal on", async () => {
		const abortSignal = new AbortController().signal;

		await provider.streamObject({ ...objectParams, abortSignal });

		expect(sdk.streamObject.mock.calls[0][0].abortSignal).toBe(abortSignal);
	});

	test.each([
		[undefined, 600_000],
		['abc', 600_000],
		['0', 600_000],
		['-5', 600_000],
		['0.5', 600_000],
		['5000', 5000],
		// AbortSignal.timeout throws on a fraction
		['1500.5', 1500],
		// A longer setTimeout fires after 1 ms
		['99999999999', 2 ** 31 - 1]
	])('TASKGRAPH_AI_TIMEOUT_MS=%s gives a limit of %i ms', (value, expected) => {
		vi.stubEnv('TASKGRAPH_AI_TIMEOUT_MS', value);

		expect(aiCallTimeoutMs()).toBe(expected);

		vi.unstubAllEnvs();
	});

	test.each([['generateObject'], ['streamObject']])(
		'%s passes the token limit as maxOutputTokens',
		async (name) => {
			await calls.find(([n]) => n === name)?.[1]();

			const options = sdk[name].mock.calls[0][0];
			expect(options.maxOutputTokens).toBe(1000);
			expect(options).not.toHaveProperty('maxTokens');
		}
	);
});
