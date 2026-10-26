import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClaudeCode as mockedCreateClaudeCode } from 'ai-sdk-provider-claude-code';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeProvider } from './claude-code.js';

// Mock the ai-sdk-provider-claude-code package
vi.mock('ai-sdk-provider-claude-code', () => ({
	createClaudeCode: vi.fn(() => {
		const provider: any = (modelId: string, settings: unknown) => ({
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

const createClaudeCode = mockedCreateClaudeCode as any;
// The config's settings for a command, as the host passes them in
const getClaudeCodeSettingsForCommand = vi.fn((): any => ({}));
const log = vi.fn();
const newProvider = () =>
	new ClaudeCodeProvider({
		log,
		getSettingsForCommand: getClaudeCodeSettingsForCommand,
		supportedModels: ['opus', 'sonnet', 'haiku']
	});

describe('ClaudeCodeProvider', () => {
	let provider: ClaudeCodeProvider;

	beforeEach(() => {
		provider = newProvider();
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
		it('should return a claude code client', async () => {
			const client = await provider.getClient({});
			expect(client).toBeDefined();
			expect(typeof client).toBe('function');
		});

		it('should create client without parameters', async () => {
			const client = await provider.getClient();
			expect(client).toBeDefined();
		});

		it('should handle commandName parameter', async () => {
			const client = await provider.getClient({
				commandName: 'test-command'
			});
			expect(client).toBeDefined();
		});

		it('should have languageModel and chat methods', async () => {
			const client: any = await provider.getClient({});
			expect(client.languageModel).toBeDefined();
			expect(client.chat).toBeDefined();
			expect(client.chat).toBe(client.languageModel);
		});

		it('should pass systemPrompt configuration to createClaudeCode', async () => {
			await provider.getClient({});

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
			await provider.getClient({});

			expect(createClaudeCode).toHaveBeenCalledWith(
				expect.objectContaining({
					defaultSettings: expect.objectContaining({
						settingSources: []
					})
				})
			);
		});

		it('should pass defaultSettings from config to createClaudeCode', async () => {
			const mockSettings = { maxTokens: 4096, temperature: 0.7 };
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(mockSettings);

			await provider.getClient({ commandName: 'test-command' });

			expect(getClaudeCodeSettingsForCommand).toHaveBeenCalledWith(
				'test-command'
			);
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
			const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
			const out = vi.spyOn(console, 'log').mockImplementation(() => {});

			await provider.getClient({ commandName: 'parse-prd' });
			const { logger } = createClaudeCode.mock.calls.at(-1)[0].defaultSettings;
			logger.warn('[claude-code] Received tool result for unknown tool ID: x');

			// The host's logger gets it at debug level, which it hides by default
			expect(log).toHaveBeenCalledWith(
				'debug',
				'[claude-code] Received tool result for unknown tool ID: x'
			);
			expect(warn).not.toHaveBeenCalled();
			expect(out).not.toHaveBeenCalled();
			warn.mockRestore();
			out.mockRestore();
		});

		it('should pass complete configuration object to createClaudeCode', async () => {
			const mockSettings = { maxTokens: 2048 };
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(mockSettings);

			await provider.getClient({
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
					maxTurns: 6,
					cwd: '/work/project',
					hooks: {
						PreToolUse: [expect.any(Object)],
						PostToolUse: [expect.any(Object)]
					}
				}
			});
		});

		describe('API key handling', () => {
			const lastEnv = () =>
				createClaudeCode.mock.calls.at(-1)[0].defaultSettings.env;
			const saved = {
				anthropic: process.env.ANTHROPIC_API_KEY,
				claudeCode: process.env.CLAUDE_CODE_API_KEY
			};

			afterEach(() => {
				for (const [key, value] of [
					['ANTHROPIC_API_KEY', saved.anthropic],
					['CLAUDE_CODE_API_KEY', saved.claudeCode]
				] as const) {
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
				}
			});

			it('withholds ANTHROPIC_API_KEY so Claude Code uses its own sign-in', async () => {
				process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-be-used';
				delete process.env.CLAUDE_CODE_API_KEY;

				await provider.getClient({});

				const env = lastEnv();
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

				await provider.getClient({ projectRoot: root });

				expect(lastEnv().ANTHROPIC_API_KEY).toBe('sk-ant-from-project');
				expect(process.env.CLAUDE_CODE_API_KEY).toBeUndefined();
			});

			it("lets the host's CLAUDE_CODE_API_KEY win over the project's .env", async () => {
				const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-env-'));
				fs.writeFileSync(
					path.join(root, '.env'),
					'CLAUDE_CODE_API_KEY=from-file\n'
				);
				process.env.CLAUDE_CODE_API_KEY = 'from-host';

				await provider.getClient({ projectRoot: root });

				expect(lastEnv().ANTHROPIC_API_KEY).toBe('from-host');
			});

			it("passes only the documented keys from the project's .env to Claude Code", async () => {
				const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-env-'));
				fs.writeFileSync(
					path.join(root, '.env'),
					[
						'HTTPS_PROXY=http://proxy.example:8080',
						'ANTHROPIC_BASE_URL=http://attacker.example',
						'NODE_EXTRA_CA_CERTS=./ca.pem',
						'NODE_OPTIONS=--require ./evil.js',
						'TM_TEST_OTHER=x'
					].join('\n')
				);

				await provider.getClient({ projectRoot: root });

				const env = lastEnv();
				expect(env.HTTPS_PROXY).toBe('http://proxy.example:8080');
				for (const key of [
					'ANTHROPIC_BASE_URL',
					'NODE_EXTRA_CA_CERTS',
					'NODE_OPTIONS',
					'TM_TEST_OTHER'
				]) {
					expect(env[key]).toBe(process.env[key]);
				}
				expect(process.env.HTTPS_PROXY).not.toBe('http://proxy.example:8080');
			});

			it('uses CLAUDE_CODE_API_KEY exclusively when it is set', async () => {
				process.env.ANTHROPIC_API_KEY = 'sk-ant-other';
				process.env.CLAUDE_CODE_API_KEY = 'sk-ant-claude-code';

				await provider.getClient({});

				expect(lastEnv().ANTHROPIC_API_KEY).toBe('sk-ant-claude-code');
			});
		});

		describe('tool restrictions per role', () => {
			const lastSettings = () =>
				createClaudeCode.mock.calls.at(-1)[0].defaultSettings;

			it.each([['main'], ['fallback'], [undefined]])(
				'gives the %s role read-only repo tools and no web, shell or MCP access',
				async (role) => {
					await provider.getClient({ role, projectRoot: '/work/project' });

					const settings = lastSettings();
					expect(settings.tools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.allowedTools).toEqual(['Read', 'Grep', 'Glob']);
					expect(settings.permissionMode).toBe('dontAsk');
					expect(settings.permissionPrompts).toBe('none');
					expect(settings.strictMcpConfig).toBe(true);
					expect(settings.mcpServers).toEqual({});
				}
			);

			it('withholds file tools when no project root is known', async () => {
				await provider.getClient({ role: 'main' });

				const settings = lastSettings();
				expect(settings.tools).toEqual([]);
				expect(settings.allowedTools).toEqual([]);
				expect(settings.settingSources).toEqual([]);
				expect(settings.cwd).toBeUndefined();
			});

			it.each([['main'], ['fallback'], [undefined]])(
				'isolates settings and scopes files to the project root for the %s role',
				async (role) => {
					await provider.getClient({ role, projectRoot: '/work/project' });

					const settings = lastSettings();
					expect(settings.settingSources).toEqual([]);
					expect(settings.cwd).toBe('/work/project');
					expect(settings.additionalDirectories).toBeUndefined();
					const [guard] = settings.hooks.PreToolUse;
					expect(guard.matcher).toBe('Read|Grep|Glob');
					expect(settings.hooks.PostToolUse[0].matcher).toBe('Grep');
				}
			);

			it('denies reads outside the project root through the hook', async () => {
				await provider.getClient({
					role: 'main',
					projectRoot: '/work/project'
				});

				const [hook] = lastSettings().hooks.PreToolUse[0].hooks;
				const out = await hook({
					tool_name: 'Read',
					tool_input: { file_path: '/etc/passwd' }
				});
				expect(out.hookSpecificOutput.permissionDecision).toBe('deny');
			});

			it('does not let config settings reopen settings sources or file scope', async () => {
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					settingSources: ['user', 'project', 'local'],
					additionalDirectories: ['/'],
					cwd: '/',
					hooks: {}
				});

				await provider.getClient({
					role: 'main',
					projectRoot: '/work/project'
				});

				const settings = lastSettings();
				expect(settings.settingSources).toEqual([]);
				expect(settings.additionalDirectories).toBeUndefined();
				expect(settings.cwd).toBe('/work/project');
				expect(settings.hooks.PreToolUse).toHaveLength(1);
				expect(settings.hooks.PostToolUse).toHaveLength(1);
			});

			it('drops a pathToClaudeCodeExecutable that is not a trusted claude binary', async () => {
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					pathToClaudeCodeExecutable: '/bin/sh'
				});

				await provider.getClient({
					role: 'main',
					projectRoot: '/work/project'
				});

				const settings = lastSettings();
				expect(settings).not.toHaveProperty('pathToClaudeCodeExecutable');
			});

			it('refuses a claude.cmd with a warning that says to use claude.exe (#524)', async () => {
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					pathToClaudeCodeExecutable: '/opt/npm/claude.cmd'
				});

				await provider.getClient({
					role: 'main',
					projectRoot: '/work/project'
				});

				expect(lastSettings()).not.toHaveProperty('pathToClaudeCodeExecutable');
				expect(log).toHaveBeenCalledWith(
					'warn',
					expect.stringContaining('claude.exe on Windows, not claude.cmd')
				);
			});

			it('gives the research role only WebSearch and WebFetch', async () => {
				await provider.getClient({ role: 'research' });

				const settings = lastSettings();
				expect(settings.tools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.allowedTools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.permissionMode).toBe('dontAsk');
				expect(settings.strictMcpConfig).toBe(true);
				expect(settings.mcpServers).toEqual({});
			});

			it('does not load user, project or local settings for the research role', async () => {
				await provider.getClient({ role: 'research' });

				const settings = lastSettings();
				expect(settings.settingSources).toEqual([]);
			});

			it('caps research turns unless the config sets maxTurns', async () => {
				await provider.getClient({ role: 'research' });
				expect(lastSettings().maxTurns).toBe(8);

				getClaudeCodeSettingsForCommand.mockReturnValueOnce({ maxTurns: 3 });
				await provider.getClient({ role: 'research' });
				expect(lastSettings().maxTurns).toBe(3);
			});

			it('caps main and fallback turns at 6 unless the config sets maxTurns', async () => {
				await provider.getClient({ role: 'main', projectRoot: '/tmp/project' });
				expect(lastSettings().maxTurns).toBe(6);
				await provider.getClient({
					role: 'fallback',
					projectRoot: '/tmp/project'
				});
				expect(lastSettings().maxTurns).toBe(6);

				getClaudeCodeSettingsForCommand.mockReturnValueOnce({ maxTurns: 12 });
				await provider.getClient({ role: 'main', projectRoot: '/tmp/project' });
				expect(lastSettings().maxTurns).toBe(12);
			});

			it('does not let config settings widen the allowed tools', async () => {
				getClaudeCodeSettingsForCommand.mockReturnValueOnce({
					allowedTools: ['Bash', 'Write'],
					tools: ['Bash'],
					permissionMode: 'bypassPermissions',
					mcpServers: { evil: { command: 'x' } }
				});

				await provider.getClient({ role: 'research' });

				const settings = lastSettings();
				expect(settings.tools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.allowedTools).toEqual(['WebSearch', 'WebFetch']);
				expect(settings.permissionMode).toBe('dontAsk');
				expect(settings.mcpServers).toEqual({});
			});
		});

		it('should pass empty defaultSettings when config returns null', async () => {
			getClaudeCodeSettingsForCommand.mockReturnValueOnce(null);

			await provider.getClient({});

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
			createClaudeCode.mockImplementationOnce(() => {
				throw new Error('Mock initialization error');
			});

			// Create a new provider instance to use the mocked createClaudeCode
			const errorProvider = newProvider();
			await expect(errorProvider.getClient({})).rejects.toThrow(
				'Mock initialization error'
			);
		});
	});
});
