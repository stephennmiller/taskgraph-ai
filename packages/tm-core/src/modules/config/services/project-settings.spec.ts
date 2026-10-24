import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getAvailableModelsList,
	setModel,
	setResponseLanguage
} from './project-settings.js';

let root: string;
const configPath = () => path.join(root, '.taskgraph', 'config.json');
const localPath = () => path.join(root, '.taskgraph', 'config.local.json');
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeConfig = (config: object) =>
	fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-settings-'));
	fs.mkdirSync(path.join(root, '.taskgraph'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('setModel', () => {
	it("keeps the role's other settings, drops baseURL and moves per-machine settings", () => {
		writeConfig({
			models: {
				main: {
					provider: 'claude-code',
					modelId: 'sonnet',
					temperature: 0.5,
					baseURL: 'x'
				}
			},
			global: { projectName: 'App' },
			claudeCode: { pathToClaudeCodeExecutable: '/bin/claude' }
		});

		const result = setModel(root, 'main', 'opus');

		expect(result).toEqual({
			success: true,
			data: {
				role: 'main',
				provider: 'claude-code',
				modelId: 'opus',
				message: 'Successfully set main model to opus (Provider: claude-code)'
			}
		});
		const saved = read(configPath());
		expect(saved.models.main).toMatchObject({
			provider: 'claude-code',
			modelId: 'opus',
			temperature: 0.5
		});
		expect(saved.models.main.baseURL).toBeUndefined();
		expect(saved.global).toEqual({ projectName: 'App' });
		expect(saved.claudeCode?.pathToClaudeCodeExecutable).toBeUndefined();
		expect(read(localPath())).toEqual({
			claudeCode: { pathToClaudeCodeExecutable: '/bin/claude' }
		});
	});

	it('refuses an unknown role or model and leaves the file alone', () => {
		writeConfig({ global: {} });
		const before = fs.readFileSync(configPath(), 'utf8');

		expect(setModel(root, 'judge', 'opus')).toMatchObject({
			success: false,
			error: { code: 'INVALID_ROLE' }
		});
		expect(setModel(root, 'main', 'gpt-4')).toMatchObject({
			success: false,
			error: { code: 'MODEL_NOT_FOUND' }
		});
		expect(fs.readFileSync(configPath(), 'utf8')).toBe(before);
	});

	it('throws without a config.json', () => {
		fs.rmSync(path.join(root, '.taskgraph'), { recursive: true });

		expect(() => setModel(root, 'main', 'opus')).toThrow(
			'The configuration file is missing'
		);
		expect(() => getAvailableModelsList(root)).toThrow(
			'The configuration file is missing'
		);
	});
});

describe('setResponseLanguage', () => {
	it('saves the language and keeps the other global settings', () => {
		writeConfig({ global: { projectName: 'App' } });

		expect(setResponseLanguage(root, 'Français')).toEqual({
			success: true,
			data: {
				responseLanguage: 'Français',
				message: 'Response language set to Français'
			}
		});
		expect(read(configPath()).global).toEqual({
			projectName: 'App',
			responseLanguage: 'Français'
		});
	});

	it('refuses an empty language, a missing config and a broken one', () => {
		expect(setResponseLanguage(root, 'English')).toMatchObject({
			success: false,
			error: { code: 'CONFIG_MISSING' }
		});
		writeConfig({});
		expect(setResponseLanguage(root, ' ')).toMatchObject({
			success: false,
			error: { code: 'INVALID_RESPONSE_LANGUAGE' }
		});
		fs.writeFileSync(configPath(), '{ not json');
		expect(setResponseLanguage(root, 'German')).toMatchObject({
			success: false,
			error: { code: 'CONFIG_WRITE_ERROR' }
		});
		expect(fs.readFileSync(configPath(), 'utf8')).toBe('{ not json');
	});
});
