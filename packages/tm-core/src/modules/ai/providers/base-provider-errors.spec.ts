/**
 * handleError keeps what the AI service's retry check reads (status, name)
 * and wraps each error once (#555).
 */
import { describe, expect, it, vi } from 'vitest';
import { BaseAIProvider } from './base-provider.js';

const sdk = vi.hoisted(() => ({ generateText: vi.fn() }));

vi.mock('ai', () => ({ generateText: sdk.generateText }));

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

const params = {
	apiKey: 'key',
	modelId: 'model',
	messages: [{ role: 'user', content: 'test' }]
};

describe('BaseAIProvider.handleError', () => {
	it('keeps the HTTP status and error name so retries can see them', async () => {
		const apiError = Object.assign(new Error('Too many requests'), {
			name: 'AI_APICallError',
			statusCode: 429
		});
		sdk.generateText.mockRejectedValue(apiError);

		const thrown = await new TestProvider()
			.generateText(params)
			.catch((error: unknown) => error);

		expect(thrown).toMatchObject({
			message:
				'TestProvider API error during text generation: Too many requests',
			status: 429,
			name: 'AI_APICallError',
			cause: apiError
		});
	});

	it('does not wrap a getClient error twice', async () => {
		const provider = new TestProvider();
		provider.getClient = () =>
			provider.handleError('client initialization', new Error('no CLI'));

		await expect(provider.generateText(params)).rejects.toThrow(
			/^TestProvider API error during client initialization: no CLI$/
		);
	});
});
