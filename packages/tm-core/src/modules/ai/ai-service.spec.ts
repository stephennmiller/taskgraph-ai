import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiService, type AiServiceHost } from './ai-service.js';
import { ClaudeCodeProvider } from './providers/claude-code.js';

// Claude Code is the only provider, so every role resolves to the same mock.
const mockClaudeProvider = vi.hoisted(() => ({
	generateText: vi.fn(),
	streamText: vi.fn(),
	generateObject: vi.fn(),
	getRequiredApiKeyName: vi.fn(() => 'CLAUDE_CODE_API_KEY'),
	isRequiredApiKey: vi.fn(() => false)
}));

vi.mock('./providers/claude-code.js', () => ({
	ClaudeCodeProvider: vi.fn(function () {
		return mockClaudeProvider;
	})
}));

const models: Record<string, { provider: string; modelId: string }> = {};
const host = {
	log: vi.fn(),
	getDebugFlag: vi.fn(),
	findProjectRoot: vi.fn(),
	getRoleModel: vi.fn((role: string) => models[role]),
	getParametersForRole: vi.fn(),
	getResponseLanguage: vi.fn(),
	getUserId: vi.fn(),
	getCurrentTag: vi.fn(() => 'master'),
	resolveEnvVariable: vi.fn(),
	getClaudeCodeSettingsForCommand: vi.fn(() => ({})),
	getSupportedModels: vi.fn(() => ['sonnet']),
	getModelMap: () => ({
		'claude-code': [
			{
				id: 'sonnet',
				cost_per_1m_tokens: { input: 0, output: 0, currency: 'USD' }
			}
		]
	})
} satisfies AiServiceHost;

const okResponse = (text: string) => ({
	text,
	usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
});

describe('AiService', () => {
	const fakeProjectRoot = '/fake/project/root';
	let service: AiService;

	beforeEach(() => {
		vi.clearAllMocks();
		mockClaudeProvider.generateText.mockReset();
		service = new AiService(host);

		models.main = { provider: 'claude-code', modelId: 'sonnet' };
		models.research = { provider: 'claude-code', modelId: 'haiku' };
		models.fallback = { provider: 'claude-code', modelId: 'opus' };
		host.getParametersForRole.mockImplementation((role: string) => {
			if (role === 'main') return { maxTokens: 100, temperature: 0.5 };
			if (role === 'research') return { maxTokens: 200, temperature: 0.3 };
			if (role === 'fallback') return { maxTokens: 150, temperature: 0.6 };
			return { maxTokens: 100, temperature: 0.5 };
		});
		host.getResponseLanguage.mockReturnValue('English');
		host.resolveEnvVariable.mockReturnValue(null);
		host.findProjectRoot.mockReturnValue(fakeProjectRoot);
		host.getDebugFlag.mockReturnValue(false);
		host.getUserId.mockReturnValue('test-user-id');
	});

	it('builds the provider once, with the host logger, settings and models', async () => {
		mockClaudeProvider.generateText.mockResolvedValue(okResponse('ok'));

		await service.generateText({ role: 'main', prompt: 'Test' });
		await service.generateText({ role: 'main', prompt: 'Again' });

		expect(host.getSupportedModels).toHaveBeenCalledWith('claude-code');
		expect(vi.mocked(ClaudeCodeProvider).mock.calls).toEqual([
			[
				{
					log: host.log,
					getSettingsForCommand: host.getClaudeCodeSettingsForCommand,
					supportedModels: ['sonnet']
				}
			]
		]);
	});

	describe('generateText', () => {
		it('should use main role and tell the provider which role it serves', async () => {
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Main provider response')
			);

			const result = await service.generateText({
				role: 'main',
				session: { env: {} },
				systemPrompt: 'System',
				prompt: 'Test'
			});

			expect(result.mainResult).toBe('Main provider response');
			expect(result).toHaveProperty('telemetryData');
			expect(host.getRoleModel).toHaveBeenCalledWith('main', fakeProjectRoot);
			expect(host.getParametersForRole).toHaveBeenCalledWith(
				'main',
				fakeProjectRoot
			);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'main', modelId: 'sonnet' })
			);
		});

		it('should fall back to the fallback role if main fails', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main provider failed'))
				.mockResolvedValueOnce(okResponse('Fallback provider response'));

			const explicitRoot = '/explicit/test/root';
			const result = await service.generateText({
				role: 'main',
				prompt: 'Fallback test',
				projectRoot: explicitRoot
			});

			expect(result.mainResult).toBe('Fallback provider response');
			expect(host.getParametersForRole).toHaveBeenCalledWith(
				'fallback',
				explicitRoot
			);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(2);
			expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
				expect.objectContaining({ role: 'fallback' })
			);
			expect(host.log).toHaveBeenCalledWith(
				'debug',
				expect.stringContaining('Service call failed for role main')
			);
		});

		it('should fall back to the research role if main and fallback fail', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main failed'))
				.mockRejectedValueOnce(new Error('Fallback failed'))
				.mockResolvedValueOnce(okResponse('Research provider response'));

			const result = await service.generateText({
				role: 'main',
				prompt: 'Research fallback test'
			});

			expect(result.mainResult).toBe('Research provider response');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(3);
			expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
				expect.objectContaining({ role: 'research' })
			);
		});

		it('should throw the last error if every role fails', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Main failed'))
				.mockRejectedValueOnce(new Error('Fallback failed'))
				.mockRejectedValueOnce(new Error('Research failed'));

			await expect(
				service.generateText({ role: 'main', prompt: 'All fail test' })
			).rejects.toThrow('Research failed');

			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(3);
		});

		it('should not retry a role that uses a provider/model that already failed', async () => {
			models.fallback.modelId = 'sonnet';
			models.research.modelId = 'sonnet';
			mockClaudeProvider.generateText.mockRejectedValue(
				new Error('Claude Code CLI not available')
			);

			await expect(
				service.generateText({ role: 'main', prompt: 'Same model everywhere' })
			).rejects.toThrow('Claude Code CLI not available');

			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
		});

		it('should handle retryable errors correctly', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(new Error('Rate limit'))
				.mockResolvedValueOnce(okResponse('Success after retry'));

			const result = await service.generateText({
				role: 'main',
				prompt: 'Retry success test'
			});

			expect(result.mainResult).toBe('Success after retry');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(2);
			expect(host.log).toHaveBeenCalledWith(
				'info',
				expect.stringContaining(
					'Something went wrong on the provider side. Retrying'
				)
			);
		});

		it.each([429, 503])(
			'retries an HTTP %i the message does not name (#555)',
			async (status) => {
				mockClaudeProvider.generateText
					.mockRejectedValueOnce(
						Object.assign(new Error('Request failed'), { status })
					)
					.mockResolvedValueOnce(okResponse('Success after retry'));

				const result = await service.generateText({
					role: 'main',
					prompt: 'Status retry test'
				});

				expect(result.mainResult).toBe('Success after retry');
				expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(2);
				expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
					expect.objectContaining({ role: 'main' })
				);
			}
		);

		it('does not retry an HTTP 400', async () => {
			mockClaudeProvider.generateText
				.mockRejectedValueOnce(
					Object.assign(new Error('Bad request'), { status: 400 })
				)
				.mockResolvedValueOnce(okResponse('Served by the fallback role'));

			await service.generateText({ role: 'main', prompt: 'No retry test' });

			expect(mockClaudeProvider.generateText).toHaveBeenLastCalledWith(
				expect.objectContaining({ role: 'fallback' })
			);
		});

		it('should skip a role configured with an unsupported provider', async () => {
			models.main.provider = 'openai';
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Served by the fallback role')
			);

			const result = await service.generateText({
				role: 'main',
				prompt: 'Unsupported provider test'
			});

			expect(result.mainResult).toBe('Served by the fallback role');
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledWith(
				expect.objectContaining({ role: 'fallback' })
			);
			expect(host.log).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining("Provider 'openai' not supported")
			);
		});

		it('should use default project root or handle null if findProjectRoot returns null', async () => {
			host.findProjectRoot.mockReturnValue(null);
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Response with no root')
			);

			await service.generateText({ role: 'main', prompt: 'No root test' });

			expect(host.getRoleModel).toHaveBeenCalledWith('main', null);
			expect(host.getParametersForRole).toHaveBeenCalledWith('main', null);
			expect(mockClaudeProvider.generateText).toHaveBeenCalledTimes(1);
		});

		it('should use configured responseLanguage in system prompt', async () => {
			host.getResponseLanguage.mockReturnValue('中文');
			mockClaudeProvider.generateText.mockResolvedValue(okResponse('中文回复'));

			await service.generateText({
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
			expect(host.getResponseLanguage).toHaveBeenCalledWith(fakeProjectRoot);
		});

		it('should pass custom projectRoot to getResponseLanguage', async () => {
			const customRoot = '/custom/project/root';
			host.getResponseLanguage.mockReturnValue('Español');
			mockClaudeProvider.generateText.mockResolvedValue(
				okResponse('Respuesta en Español')
			);

			await service.generateText({
				role: 'main',
				systemPrompt: 'You are an assistant',
				prompt: 'Hello',
				projectRoot: customRoot
			});

			expect(host.getResponseLanguage).toHaveBeenCalledWith(customRoot);
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

		it('should pass temperature to claude-code provider (provider handles filtering)', async () => {
			host.getParametersForRole.mockReturnValue({
				maxTokens: 64000,
				temperature: 0.7
			});
			mockClaudeProvider.generateText.mockResolvedValueOnce(
				okResponse('ok-claude')
			);

			const result = await service.generateText({
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
