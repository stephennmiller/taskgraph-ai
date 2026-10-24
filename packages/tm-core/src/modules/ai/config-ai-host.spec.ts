/**
 * AiConfig reads AI settings from ConfigManager the way the legacy
 * config-manager.js did: role defaults, the token cap from
 * supported-models.json, the claudeCode schema and the env lookup order.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigManager } from '../config/managers/config-manager.js';
import { AiConfig, type AiReport } from './config-ai-host.js';

describe('AiConfig', () => {
	let projectRoot: string;

	const aiConfig = (config: Record<string, unknown>, report?: AiReport) =>
		new AiConfig(
			{
				getConfig: () => config,
				getConfigSources: () => [{ name: 'local', config }],
				getProjectRoot: () => projectRoot,
				getResponseLanguage: () => 'English',
				getActiveTag: () => 'master'
			} as unknown as ConfigManager,
			report
		);

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-config-'));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	describe('roleModel', () => {
		it('lays the configured role over the defaults', () => {
			const config = aiConfig({ models: { main: { modelId: 'opus' } } });

			expect(config.roleModel('main')).toEqual({
				provider: 'claude-code',
				modelId: 'opus',
				maxTokens: 64000,
				temperature: 0.2
			});
			expect(config.roleModel('research').maxTokens).toBe(8700);
		});

		it('uses the default fallback unless both provider and model are set', () => {
			const config = aiConfig({ models: { fallback: { modelId: 'haiku' } } });

			expect(config.roleModel('fallback').modelId).toBe('sonnet');
		});

		it('falls back to the default model for an unsupported provider, warning once', () => {
			const report = vi.fn();
			const config = aiConfig(
				{ models: { main: { provider: 'openai', modelId: 'gpt' } } },
				report
			);

			config.roleModel('main');
			expect(config.roleModel('main')).toMatchObject({
				provider: 'claude-code',
				modelId: 'sonnet'
			});
			expect(report).toHaveBeenCalledTimes(1);
			expect(report).toHaveBeenCalledWith(
				'warn',
				'main provider "openai" isn\'t supported; using sonnet. Run taskgraph models --setup to change it'
			);
		});

		it('keeps the config file model when TASKGRAPH_MODEL_MAIN is set, as the legacy loader did', async () => {
			fs.mkdirSync(path.join(projectRoot, '.taskgraph'));
			fs.writeFileSync(
				path.join(projectRoot, '.taskgraph', 'config.json'),
				JSON.stringify({ models: { main: { modelId: 'opus' } } })
			);
			vi.stubEnv('TASKGRAPH_MODEL_MAIN', 'haiku');
			const manager = await ConfigManager.create(projectRoot);

			expect(new AiConfig(manager).roleModel('main')).toEqual({
				provider: 'claude-code',
				modelId: 'opus',
				maxTokens: 64000,
				temperature: 0.2
			});
		});
	});

	it("caps maxTokens at the model's limit in supported-models.json", () => {
		const config = aiConfig({
			models: { main: { modelId: 'opus', maxTokens: 100000 } }
		});

		expect(config.parametersForRole('main')).toEqual({
			maxTokens: 32000,
			temperature: 0.2
		});
	});

	describe('claudeCodeSettingsFor', () => {
		it("merges the command's commandSpecific entry over the settings", () => {
			const config = aiConfig({
				claudeCode: {
					maxTurns: 6,
					commandSpecific: { 'add-task': { maxTurns: 3 } }
				}
			});

			expect(config.claudeCodeSettingsFor('add-task')).toEqual({ maxTurns: 3 });
			expect(config.claudeCodeSettingsFor('research')).toEqual({ maxTurns: 6 });
		});

		it('drops invalid settings with a warning', () => {
			const report = vi.fn();
			const config = aiConfig({ claudeCode: { maxTurns: -1 } }, report);

			expect(config.claudeCodeSettingsFor('add-task')).toEqual({});
			expect(report).toHaveBeenCalledWith(
				'warn',
				expect.stringContaining('Invalid Claude Code settings in config')
			);
		});
	});

	describe('resolveEnv', () => {
		it('reads the session, then .env, then process.env', () => {
			fs.writeFileSync(path.join(projectRoot, '.env'), 'KEY=from-file\n');
			vi.stubEnv('KEY', 'from-process');
			vi.stubEnv('OTHER', 'from-process');
			const config = aiConfig({});

			expect(config.resolveEnv('KEY', { env: { KEY: 'from-session' } })).toBe(
				'from-session'
			);
			expect(config.resolveEnv('KEY')).toBe('from-file');
			expect(config.resolveEnv('OTHER')).toBe('from-process');
			expect(config.resolveEnv('MISSING')).toBeUndefined();
		});
	});

	describe('hasCodebaseAnalysis', () => {
		it('is on for the main role with Claude Code, off for research', () => {
			const config = aiConfig({});

			expect(config.hasCodebaseAnalysis(false)).toBe(true);
			expect(config.hasCodebaseAnalysis(true)).toBe(false);
		});

		it('follows the env flag over the config', () => {
			vi.stubEnv('TASKGRAPH_ENABLE_CODEBASE_ANALYSIS', 'false');

			expect(aiConfig({}).hasCodebaseAnalysis(false)).toBe(false);
			expect(
				aiConfig({
					global: { enableCodebaseAnalysis: false }
				}).hasCodebaseAnalysis(false, {
					env: { TASKGRAPH_ENABLE_CODEBASE_ANALYSIS: '1' }
				})
			).toBe(true);
		});
	});

	describe('toHost log', () => {
		it('reports warnings and errors, and debug lines only with global.debug', () => {
			const quiet = vi.fn();
			const loud = vi.fn();
			const quietLog = aiConfig({}, quiet).toHost().log;
			const loudLog = aiConfig({ global: { debug: true } }, loud).toHost().log;

			for (const log of [quietLog, loudLog]) {
				log('warn', 'Retrying in 2s', { attempt: 1 });
				log('error', 'Service call failed');
				log('debug', 'Skipping role');
			}

			expect(quiet.mock.calls).toEqual([
				['warn', 'Retrying in 2s {"attempt":1}'],
				['warn', 'Service call failed']
			]);
			expect(loud.mock.calls).toContainEqual(['debug', 'Skipping role']);
		});
	});
});
