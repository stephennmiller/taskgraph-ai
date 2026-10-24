import { describe, expect, it, vi } from 'vitest';
import { BaseAIProvider } from './base-provider.js';

const state = vi.hoisted(() => ({ failNext: true }));

vi.mock('ai', () => {
	if (state.failNext) {
		state.failNext = false;
		throw new Error('ai failed to load');
	}
	return {
		generateText: vi.fn(async () => ({ text: 'ok', usage: {} }))
	};
});

class TestProvider extends BaseAIProvider {
	getClient() {
		return (modelId: string) => modelId as any;
	}
	getRequiredApiKeyName() {
		return null;
	}
	validateAuth() {}
}

const params = {
	modelId: 'm',
	messages: [{ role: 'user', content: 'hi' }]
};

describe('BaseAIProvider SDK loading', () => {
	it('loads the SDK again on the next call after a failed load', async () => {
		const provider = new TestProvider(vi.fn());

		await expect(provider.generateText(params)).rejects.toThrow(
			/text generation/
		);
		const result = await provider.generateText(params);

		expect(result.text).toBe('ok');
	});
});
