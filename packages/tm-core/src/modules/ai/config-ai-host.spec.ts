/**
 * AiConfig reads AI settings from ConfigManager the way the legacy
 * config-manager.js does: role defaults, the token cap from
 * supported-models.json, the claudeCode schema and the env lookup order.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigManager } from '../config/managers/config-manager.js';
import { AiConfig } from './config-ai-host.js';

describe('AiConfig', () => {
	let projectRoot: string;

	const aiConfig = (config: Record<string, unknown>) =>
		new AiConfig({
			getConfig: () => config,
			getProjectRoot: () => projectRoot,
			getResponseLanguage: () => 'English',
			getActiveTag: () => 'master'
		} as unknown as ConfigManager);

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

		it('falls back to the default model for an unsupported provider', () => {
			const config = aiConfig({
				models: { main: { provider: 'openai', modelId: 'gpt' } }
			});

			expect(config.roleModel('main')).toMatchObject({
				provider: 'claude-code',
				modelId: 'sonnet'
			});
		});

		it('ignores a role set to a bare string (TASKGRAPH_MODEL_MAIN)', () => {
			expect(
				aiConfig({ models: { main: 'opus' } }).roleModel('main').modelId
			).toBe('sonnet');
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

		it('drops invalid settings', () => {
			const config = aiConfig({ claudeCode: { maxTurns: -1 } });

			expect(config.claudeCodeSettingsFor('add-task')).toEqual({});
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
});
