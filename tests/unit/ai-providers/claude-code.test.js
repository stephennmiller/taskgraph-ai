import { vi } from 'vitest';

// Mock the ai-sdk-provider-claude-code package
vi.doMock('ai-sdk-provider-claude-code', () => ({
	createClaudeCode: vi.fn(() => {
		const provider = (modelId, settings) => ({
			// Minimal mock language model surface
			id: modelId,
			settings,
			doGenerate: vi.fn(() => ({ text: 'ok', usage: {} })),
			doStream: vi.fn(() => ({ stream: true }))
		});
		provider.languageModel = vi.fn((id, settings) => ({ id, settings }));
		provider.chat = provider.languageModel;
		return provider;
	})
}));

// Mock the base provider
vi.doMock('../../../src/ai-providers/base-provider.js', () => ({
	BaseAIProvider: class {
		constructor() {
			this.name = 'Base Provider';
		}
		handleError(context, error) {
			throw error;
		}
	}
}));

// Mock config getters
vi.doMock('../../../scripts/modules/config-manager.js', () => ({
	getClaudeCodeSettingsForCommand: vi.fn(() => ({})),
	getSupportedModelsForProvider: vi.fn(() => ['opus', 'sonnet', 'haiku']),
	getDebugFlag: vi.fn(() => false),
	getLogLevel: vi.fn(() => 'info')
}));

// Import after mocking
const { ClaudeCodeProvider } = await import(
	'../../../src/ai-providers/claude-code.js'
);

describe('ClaudeCodeProvider', () => {
	let provider;

	beforeEach(() => {
		provider = new ClaudeCodeProvider();
		vi.clearAllMocks();
	});

	describe('constructor', () => {
		it('should set the provider name to Claude Code', () => {
			expect(provider.name).toBe('Claude Code');
		});
	});

	describe('validateAuth', () => {
		it('should not throw an error (no API key required)', () => {
			expect(() => provider.validateAuth({})).not.toThrow();
		});

		it('should not require any parameters', () => {
			expect(() => provider.validateAuth()).not.toThrow();
		});

		it('should work with any params passed', () => {
			expect(() =>
				provider.validateAuth({
					apiKey: 'some-key',
					baseURL: 'https://example.com'
				})
			).not.toThrow();
		});
	});

	describe('getClient', () => {
		it('should return a claude code client', () => {
			const client = provider.getClient({});
			expect(client).toBeDefined();
			expect(typeof client).toBe('function');
		});

		it('should create client without parameters', () => {
			const client = provider.getClient();
			expect(client).toBeDefined();
		});

		it('should handle commandName parameter', () => {
			const client = provider.getClient({
				commandName: 'test-command'
			});
			expect(client).toBeDefined();
		});

		it('should have languageModel and chat methods', () => {
			const client = provider.getClient({});
			expect(client.languageModel).toBeDefined();
			expect(client.chat).toBeDefined();
			expect(client.chat).toBe(client.languageModel);
		});

		it('should pass systemPrompt configuration to createClaudeCode', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');

			provider.getClient({});

			expect(createClaudeCode).toHaveBeenCalledWith(
				expect.objectContaining({
					defaultSettings: expect.objectContaining({
						systemPrompt: {
							type: 'preset',
							preset: 'claude_code'
						}
					})
				})
			);
		});

		it('should pass settingSources configuration to createClaudeCode', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');

			provider.getClient({});

			expect(createClaudeCode).toHaveBeenCalledWith(
				expect.objectContaining({
					defaultSettings: expect.objectContaining({
						settingSources: ['user', 'project', 'local']
					})
				})
			);
		});

		it('should pass defaultSettings from config to createClaudeCode', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const { getClaudeCodeSettingsForCommand } = await import(
				'../../../scripts/modules/config-manager.js'
			);

			const mockSettings = { maxTokens: 4096, temperature: 0.7 };
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(mockSettings);

			provider.getClient({ commandName: 'test-command' });

			expect(createClaudeCode).toHaveBeenCalledWith(
				expect.objectContaining({
					defaultSettings: expect.objectContaining({
						...mockSettings,
						systemPrompt: {
							type: 'preset',
							preset: 'claude_code'
						},
						settingSources: ['user', 'project', 'local']
					})
				})
			);
		});

		it('should pass complete configuration object to createClaudeCode', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const { getClaudeCodeSettingsForCommand } = await import(
				'../../../scripts/modules/config-manager.js'
			);

			const mockSettings = { maxTokens: 2048 };
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(mockSettings);

			provider.getClient({ commandName: 'analyze' });

			// Verify the complete configuration structure matches v2.0 migration requirements
			expect(createClaudeCode).toHaveBeenCalledWith({
				defaultSettings: {
					...mockSettings,
					// Restores pre-2.0 behavior: explicit system prompt preset
					systemPrompt: {
						type: 'preset',
						preset: 'claude_code'
					},
					// Restores pre-2.0 behavior: enables loading of CLAUDE.md and settings.json
					settingSources: ['user', 'project', 'local'],
					env: expect.any(Object),
					// Main/fallback roles may only read the repo (codebase analysis)
					tools: ['Read', 'Grep', 'Glob'],
					allowedTools: ['Read', 'Grep', 'Glob'],
					permissionMode: 'dontAsk',
					permissionPrompts: 'none',
					strictMcpConfig: true,
					mcpServers: {}
				}
			});
		});

		describe('API key handling', () => {
			const lastEnv = async () => {
				const { createClaudeCode } = await import(
					'ai-sdk-provider-claude-code'
				);
				return createClaudeCode.mock.calls.at(-1)[0].defaultSettings.env;
			};
			const saved = {
				anthropic: process.env.ANTHROPIC_API_KEY,
				claudeCode: process.env.CLAUDE_CODE_API_KEY
			};

			afterEach(() => {
				for (const [key, value] of [
					['ANTHROPIC_API_KEY', saved.anthropic],
					['CLAUDE_CODE_API_KEY', saved.claudeCode]
				]) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			});

			it('withholds ANTHROPIC_API_KEY so Claude Code uses its own sign-in', async () => {
				process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-used';
				delete process.env.CLAUDE_CODE_API_KEY;

				provider.getClient({});

				const env = await lastEnv();
				expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
				// The process environment itself is left untouched
				expect(process.env.ANTHROPIC_API_KEY).toBe('sk-ant-should-not-be-used');
			});

			it('uses CLAUDE_CODE_API_KEY exclusively when it is set', async () => {
				process.env.ANTHROPIC_API_KEY = 'sk-ant-other';
				process.env.CLAUDE_CODE_API_KEY = 'sk-ant-claude-code';

				provider.getClient({});

				expect((await lastEnv()).ANTHROPIC_API_KEY).toBe('sk-ant-claude-code');
			});
		});

		describe('tool restrictions per role', () => {
			const lastSettings = async () => {
				const { createClaudeCode } = await import(
					'ai-sdk-provider-claude-code'
				);
				return createClaudeCode.mock.calls.at(-1)[0].defaultSettings;
			};

			it.each([['main'], ['fallback'], [undefined]])(
				'gives the %s role read-only repo tools and no web, shell or MCP access',
				async (role) => {
					provider.getClient({ role });

					const settings = await lastSettings();
					expect(settings.tools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.permissionMode).toBe('dontAsk');
					expect(settings.permissionPrompts).toBe('none');
					expect(settings.strictMcpConfig).toBe(true);
					expect(settings.mcpServers).toEqual({});
				}
			);

			it('gives the research role only WebSearch and WebFetch', async () => {
				provider.getClient({ role: 'research' });

				const settings = await lastSettings();
				expect(settings.tools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.allowedTools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.permissionMode).toBe('dontAsk');
				expect(settings.strictMcpConfig).toBe(true);
				expect(settings.mcpServers).toEqual({});
			});

			it('does not load user, project or local settings for the research role', async () => {
				provider.getClient({ role: 'research' });

				const settings = await lastSettings();
				expect(settings.settingSources).toEqual([]);
			});

			it('caps research turns unless the config sets maxTurns', async () => {
				const { getClaudeCodeSettingsForCommand } = await import(
					'../../../scripts/modules/config-manager.js'
				);

				provider.getClient({ role: 'research' });
				expect((await lastSettings()).maxTurns).toBe(8);

				getClaudeCodeSettingsForCommand.mockReturnValueOnce({ maxTurns: 3 });
				provider.getClient({ role: 'research' });
				expect((await lastSettings()).maxTurns).toBe(3);
			});

			it('does not let config settings widen the allowed tools', async () => {
				const { getClaudeCodeSettingsForCommand } = await import(
					'../../../scripts/modules/config-manager.js'
				);
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					allowedTools: ['Bash', 'Write'],
					tools: ['Bash'],
					permissionMode: 'bypassPermissions',
					mcpServers: { evil: { command: 'x' } }
				});

				provider.getClient({ role: 'research' });

				const settings = await lastSettings();
				expect(settings.tools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.allowedTools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.permissionMode).toBe('dontAsk');
				expect(settings.mcpServers).toEqual({});
			});
		});

		it('should pass empty defaultSettings when config returns null', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const { getClaudeCodeSettingsForCommand } = await import(
				'../../../scripts/modules/config-manager.js'
			);

			getClaudeCodeSettingsForCommand.mockReturnValueOnce(null);

			provider.getClient({});

			expect(createClaudeCode).toHaveBeenCalledWith(
				expect.objectContaining({
					defaultSettings: expect.objectContaining({
						systemPrompt: {
							type: 'preset',
							preset: 'claude_code'
						},
						settingSources: ['user', 'project', 'local']
					})
				})
			);
		});
	});

	describe('model support', () => {
		it('should return supported models', () => {
			const models = provider.getSupportedModels();
			expect(models).toEqual(['opus', 'sonnet', 'haiku']);
		});

		it('should check if model is supported', () => {
			expect(provider.isModelSupported('sonnet')).toBe(true);
			expect(provider.isModelSupported('opus')).toBe(true);
			expect(provider.isModelSupported('haiku')).toBe(true);
			expect(provider.isModelSupported('unknown')).toBe(false);
		});
	});

	describe('error handling', () => {
		it('should handle client initialization errors', async () => {
			// Force an error by making createClaudeCode throw
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			createClaudeCode.mockImplementationOnce(() => {
				throw new Error('Mock initialization error');
			});

			// Create a new provider instance to use the mocked createClaudeCode
			const errorProvider = new ClaudeCodeProvider();
			expect(() => errorProvider.getClient({})).toThrow(
				'Mock initialization error'
			);
		});
	});
});
