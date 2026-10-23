import { vi } from 'vitest';

// Claude Code is the only provider, so every role resolves to the same mock.
const mockGetMainProvider = vi.fn();
const mockGetMainModelId = vi.fn();
const mockGetResearchProvider = vi.fn();
const mockGetResearchModelId = vi.fn();
const mockGetFallbackProvider = vi.fn();
const mockGetFallbackModelId = vi.fn();
const mockGetParametersForRole = vi.fn();
const mockGetResponseLanguage = vi.fn();
const mockGetUserId = vi.fn();
const mockGetDebugFlag = vi.fn();

const mockModelMap = {
	'claude-code': [
		{
			id: 'sonnet',
			cost_per_1m_tokens: { input: 0, output: 0, currency: 'USD' }
		}
	]
};

vi.doMock('../../scripts/modules/config-manager.js', () => ({
	MODEL_MAP: mockModelMap,
	getMainProvider: mockGetMainProvider,
	getMainModelId: mockGetMainModelId,
	getResearchProvider: mockGetResearchProvider,
	getResearchModelId: mockGetResearchModelId,
	getFallbackProvider: mockGetFallbackProvider,
	getFallbackModelId: mockGetFallbackModelId,
	getParametersForRole: mockGetParametersForRole,
	getResponseLanguage: mockGetResponseLanguage,
	getUserId: mockGetUserId,
	getDebugFlag: mockGetDebugFlag
}));

// Claude Code mock provider instance
const mockClaudeProvider = {
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
	getRequiredApiKeyName: vi.fn(() => 'CLAUDE_CODE_API_KEY'),
	isRequiredApiKey: vi.fn(() => false)
};

vi.doMock('../../src/ai-providers/index.js', () => ({
	ClaudeCodeProvider: vi.fn(function () {
		return mockClaudeProvider;
	})
}));

const mockLog = vi.fn();
const mockResolveEnvVariable = vi.fn();
const mockFindProjectRoot = vi.fn();
const mockIsSilentMode = vi.fn();
const mockLogAiUsage = vi.fn();
const mockGetCurrentTag = vi.fn(() => 'master');

vi.doMock('../../scripts/modules/utils.js', () => ({
	LOG_LEVELS: { error: 0, warn: 1, info: 2, debug: 3 },
	log: mockLog,
	resolveEnvVariable: mockResolveEnvVariable,
	findProjectRoot: mockFindProjectRoot,
	isSilentMode: mockIsSilentMode,
	logAiUsage: mockLogAiUsage,
	getCurrentTag: mockGetCurrentTag
}));

// Import the module to test (AFTER mocks)
const { generateTextService } = await import(
	'../../scripts/modules/ai-services-unified.js'
);

const okResponse = (text) => ({
	text,
	usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
});

describe('Unified AI Services', () => {
	const fakeProjectRoot = '/fake/project/root';

	beforeEach(() => {
		vi.clearAllMocks();
		mockClaudeProvider.generateText.mockReset();

		mockGetMainProvider.mockReturnValue('claude-code');
		mockGetMainModelId.mockReturnValue('sonnet');
		mockGetResearchProvider.mockReturnValue('claude-code');
		mockGetResearchModelId.mockReturnValue('haiku');
		mockGetFallbackProvider.mockReturnValue('claude-code');
		mockGetFallbackModelId.mockReturnValue('opus');
		mockGetParametersForRole.mockImplementation((role) => {
			if (role === 'main') return { maxTokens: 100, temperature: 0.5 };
			if (role === 'research') return { maxTokens: 200, temperature: 0.3 };
			if (role === 'fallback') return { maxTokens: 150, temperature: 0.6 };
			return { maxTokens: 100, temperature: 0.5 };
		});
		mockGetResponseLanguage.mockReturnValue('English');
		mockResolveEnvVariable.mockReturnValue(null);
		mockFindProjectRoot.mockReturnValue(fakeProjectRoot);
		mockGetDebugFlag.mockReturnValue(false);
		mockGetUserId.mockReturnValue('test-user-id');
	});

	describe('generateTextService', () => {
		test('should use main role and tell the provider which role it serves', async () => {
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Main provider response')
			);

			const result = await generateTextService({
				role: 'main',
				session: { env: {} },
				systemPrompt: 'System',
				prompt: 'Test'
			});

			expect(result.mainResult).toBe('Main provider response');
			expect(result).toHaveProperty('telemetryData');
			expect(mockGetMainProvider).toHaveBeenCalledWith(fakeProjectRoot);
			expect(mockGetParametersForRole).toHaveBeenCalledWith(
				'main',
				fakeProjectRoot
			);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'main', modelId: 'sonnet' })
			);
		});

		test('should fall back to the fallback role if main fails', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main provider failed'))
				.mockResolvedValueOnce(okResponse('Fallback provider response'));

			const explicitRoot = '/explicit/test/root';
			const result = await generateTextService({
				role: 'main',
				prompt: 'Fallback test',
				projectRoot: explicitRoot
			});

			expect(result.mainResult).toBe('Fallback provider response');
			expect(mockGetParametersForRole).toHaveBeenCalledWith(
				'fallback',
				explicitRoot
			);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(2);
			expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
				expect.objectContaining({ role: 'fallback' })
			);
			expect(mockLog).toHaveBeenCalledWith(
				'debug',
				expect.stringContaining('Service call failed for role main')
			);
		});

		test('should fall back to the research role if main and fallback fail', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main failed'))
				.mockRejectedValueOnce(new Error('Fallback failed'))
				.mockResolvedValueOnce(okResponse('Research provider response'));

			const result = await generateTextService({
				role: 'main',
				prompt: 'Research fallback test'
			});

			expect(result.mainResult).toBe('Research provider response');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(3);
			expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
				expect.objectContaining({ role: 'research' })
			);
		});

		test('should throw the last error if every role fails', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main failed'))
				.mockRejectedValueOnce(new Error('Fallback failed'))
				.mockRejectedValueOnce(new Error('Research failed'));

			await expect(
				generateTextService({ role: 'main', prompt: 'All fail test' })
			).rejects.toThrow('Research failed');

			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(3);
		});

		test('should not retry a role that uses a provider/model that already failed', async () => {
			mockGetFallbackModelId.mockReturnValue('sonnet');
			mockGetResearchModelId.mockReturnValue('sonnet');
			mockClaudeProvider.generateText.mockRejectedValue(
				new Error('Claude Code CLI not available')
			);

			await expect(
				generateTextService({ role: 'main', prompt: 'Same model everywhere' })
			).rejects.toThrow('Claude Code CLI not available');

			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
		});

		test('should handle retryable errors correctly', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Rate limit'))
				.mockResolvedValueOnce(okResponse('Success after retry'));

			const result = await generateTextService({
				role: 'main',
				prompt: 'Retry success test'
			});

			expect(result.mainResult).toBe('Success after retry');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(2);
			expect(mockLog).toHaveBeenCalledWith(
				'info',
				expect.stringContaining(
					'Something went wrong on the provider side. Retrying'
				)
			);
		});

		test('should skip a role configured with an unsupported provider', async () => {
			mockGetMainProvider.mockReturnValue('openai');
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Served by the fallback role')
			);

			const result = await generateTextService({
				role: 'main',
				prompt: 'Unsupported provider test'
			});

			expect(result.mainResult).toBe('Served by the fallback role');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'fallback' })
			);
			expect(mockLog).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining("Provider 'openai' not supported")
			);
		});

		test('should use default project root or handle null if findProjectRoot returns null', async () => {
			mockFindProjectRoot.mockReturnValue(null);
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Response with no root')
			);

			await generateTextService({ role: 'main', prompt: 'No root test' });

			expect(mockGetMainProvider).toHaveBeenCalledWith(null);
			expect(mockGetParametersForRole).toHaveBeenCalledWith('main', null);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
		});

		test('should use configured responseLanguage in system prompt', async () => {
			mockGetResponseLanguage.mockReturnValue('中文');
			mockClaudeProvider.generateText.mockResolvedValue(okResponse('中文回复'));

			await generateTextService({
				role: 'main',
				systemPrompt: 'You are an assistant',
				prompt: 'Hello'
			});

			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: [
						{
							role: 'system',
							content: expect.stringContaining('Always respond in 中文')
						},
						{ role: 'user', content: 'Hello' }
					]
				})
			);
			expect(mockGetResponseLanguage).toHaveBeenCalledWith(fakeProjectRoot);
		});

		test('should pass custom projectRoot to getResponseLanguage', async () => {
			const customRoot = '/custom/project/root';
			mockGetResponseLanguage.mockReturnValue('Español');
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Respuesta en Español')
			);

			await generateTextService({
				role: 'main',
				systemPrompt: 'You are an assistant',
				prompt: 'Hello',
				projectRoot: customRoot
			});

			expect(mockGetResponseLanguage).toHaveBeenCalledWith(customRoot);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({
					messages: [
						{
							role: 'system',
							content: expect.stringContaining('Always respond in Español')
						},
						{ role: 'user', content: 'Hello' }
					]
				})
			);
		});

		test('should pass temperature to claude-code provider (provider handles filtering)', async () => {
			mockGetParametersForRole.mockReturnValue({
				maxTokens: 64000,
				temperature: 0.7
			});
			mockClaudeProvider.generateText.mockResolvedValueOnce(
				okResponse('ok-claude')
			);

			const result = await generateTextService({
				role: 'main',
				prompt: 'Hello Claude',
				projectRoot: fakeProjectRoot
			});

			expect(result.mainResult).toBe('ok-claude');
			// The provider (BaseAIProvider) filters it based on supportsTemperature
			const callArgs = mockClaudeProvider.generateText.mock.calls[0][0];
			expect(callArgs).toHaveProperty('temperature', 0.7);
			expect(callArgs.maxTokens).toBe(64000);
		});
	});
});
