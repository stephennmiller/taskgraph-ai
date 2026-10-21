import fs from 'fs';
import os from 'os';
import path from 'path';
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
const { ClaudeCodeProvider, isTrustedClaudeExecutable } = await import(
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
						settingSources: []
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
						settingSources: []
					})
				})
			);
		});

		it('keeps the SDK warnings out of the terminal at the default log level', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const out = vi.spyOn(console, 'log').mockImplementation(() => {});

			provider.getClient({ commandName: 'parse-prd' });
			const { logger } = createClaudeCode.mock.calls.at(-1)[0].defaultSettings;
			logger.warn('[claude-code] Received tool result for unknown tool ID: x');

			expect(warn).not.toHaveBeenCalled();
			expect(out).not.toHaveBeenCalled();
			warn.mockRestore();
			out.mockRestore();
		});

		it('should pass complete configuration object to createClaudeCode', async () => {
			const { createClaudeCode } = await import('ai-sdk-provider-claude-code');
			const { getClaudeCodeSettingsForCommand } = await import(
				'../../../scripts/modules/config-manager.js'
			);

			const mockSettings = { maxTokens: 2048 };
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(mockSettings);

			provider.getClient({
				commandName: 'analyze',
				projectRoot: '/work/project'
			});

			// Verify the complete configuration structure matches v2.0 migration requirements
			expect(createClaudeCode).toHaveBeenCalledWith({
				defaultSettings: {
					...mockSettings,
					// Restores pre-2.0 behavior: explicit system prompt preset
					systemPrompt: {
						type: 'preset',
						preset: 'claude_code'
					},
					// No settings sources: a project's hooks and CLAUDE.md stay out
					settingSources: [],
					env: expect.any(Object),
					logger: {
						debug: expect.any(Function),
						info: expect.any(Function),
						warn: expect.any(Function),
						error: expect.any(Function)
					},
					// Main/fallback roles may only read the repo (codebase analysis)
					tools: ['Read', 'Grep', 'Glob'],
					allowedTools: ['Read', 'Grep', 'Glob'],
					permissionMode: 'dontAsk',
					permissionPrompts: 'none',
					strictMcpConfig: true,
					mcpServers: {},
					cwd: '/work/project',
					hooks: { PreToolUse: [expect.any(Object)] }
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

			it("reads CLAUDE_CODE_API_KEY from the project's .env without loading it into process.env", async () => {
				const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-env-'));
				fs.writeFileSync(
					path.join(root, '.env'),
					'CLAUDE_CODE_API_KEY=sk-ant-from-project\n'
				);
				delete process.env.CLAUDE_CODE_API_KEY;

				provider.getClient({ projectRoot: root });

				expect((await lastEnv()).ANTHROPIC_API_KEY).toBe('sk-ant-from-project');
				expect(process.env.CLAUDE_CODE_API_KEY).toBeUndefined();
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
					provider.getClient({ role, projectRoot: '/work/project' });

					const settings = await lastSettings();
					expect(settings.tools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.permissionMode).toBe('dontAsk');
					expect(settings.permissionPrompts).toBe('none');
					expect(settings.strictMcpConfig).toBe(true);
					expect(settings.mcpServers).toEqual({});
				}
			);

			it('withholds file tools when no project root is known', async () => {
				provider.getClient({ role: 'main' });

				const settings = await lastSettings();
				expect(settings.tools).toEqual([]);
				expect(settings.allowedTools).toEqual([]);
				expect(settings.settingSources).toEqual([]);
				expect(settings.cwd).toBeUndefined();
			});

			it.each([['main'], ['fallback'], [undefined]])(
				'isolates settings and scopes files to the project root for the %s role',
				async (role) => {
					provider.getClient({ role, projectRoot: '/work/project' });

					const settings = await lastSettings();
					expect(settings.settingSources).toEqual([]);
					expect(settings.cwd).toBe('/work/project');
					expect(settings.additionalDirectories).toBeUndefined();
					const [guard] = settings.hooks.PreToolUse;
					expect(guard.matcher).toBe('Read|Grep|Glob');
				}
			);

			it('denies reads outside the project root through the hook', async () => {
				provider.getClient({ role: 'main', projectRoot: '/work/project' });

				const [hook] = (await lastSettings()).hooks.PreToolUse[0].hooks;
				const out = await hook({
					tool_name: 'Read',
					tool_input: { file_path: '/etc/passwd' }
				});
				expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
			});

			it('does not let config settings reopen settings sources or file scope', async () => {
				const { getClaudeCodeSettingsForCommand } = await import(
					'../../../scripts/modules/config-manager.js'
				);
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					settingSources: ['user', 'project', 'local'],
					additionalDirectories: ['/'],
					cwd: '/',
					hooks: {}
				});

				provider.getClient({ role: 'main', projectRoot: '/work/project' });

				const settings = await lastSettings();
				expect(settings.settingSources).toEqual([]);
				expect(settings.additionalDirectories).toBeUndefined();
				expect(settings.cwd).toBe('/work/project');
				expect(settings.hooks.PreToolUse).toHaveLength(1);
			});

			it('drops a pathToClaudeCodeExecutable that is not a trusted claude binary', async () => {
				const { getClaudeCodeSettingsForCommand } = await import(
					'../../../scripts/modules/config-manager.js'
				);
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					pathToClaudeCodeExecutable: '/bin/sh'
				});

				provider.getClient({ role: 'main', projectRoot: '/work/project' });

				const settings = await lastSettings();
				expect(settings).not.toHaveProperty('pathToClaudeCodeExecutable');
			});

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
						settingSources: []
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

	describe('isTrustedClaudeExecutable', () => {
		let base;
		let project;
		let outsideClaude;

		beforeAll(() => {
			base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tg-exe-')));
			project = path.join(base, 'project');
			fs.mkdirSync(path.join(project, 'bin'), { recursive: true });
			fs.mkdirSync(path.join(base, 'bin'));
			outsideClaude = path.join(base, 'bin', 'claude');
			fs.writeFileSync(outsideClaude, '');
			fs.writeFileSync(path.join(project, 'bin', 'claude'), '');
			fs.writeFileSync(path.join(base, 'bin', 'sh'), '');
			// A link outside the project named claude that points into it
			fs.symlinkSync(
				path.join(project, 'bin', 'claude'),
				path.join(base, 'claude')
			);
		});

		afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

		it('allows an absolute claude binary outside the project', () => {
			expect(isTrustedClaudeExecutable(outsideClaude, project)).toBe(true);
		});

		it('refuses relative paths, other names and missing files', () => {
			expect(isTrustedClaudeExecutable('bin/claude', project)).toBe(false);
			expect(
				isTrustedClaudeExecutable(path.join(base, 'bin', 'sh'), project)
			).toBe(false);
			expect(
				isTrustedClaudeExecutable(path.join(base, 'nope', 'claude'), project)
			).toBe(false);
		});

		it('refuses a claude inside the project, directly or through a link', () => {
			expect(
				isTrustedClaudeExecutable(path.join(project, 'bin', 'claude'), project)
			).toBe(false);
			expect(
				isTrustedClaudeExecutable(path.join(base, 'claude'), project)
			).toBe(false);
		});
	});
});
