/**
 * writeConfig with a .taskgraph/config.local.json next to config.json (#257).
 * Uses a real temp project; nothing is mocked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	getConfig,
	writeConfig
} from '../../../../scripts/modules/config-manager.js';

let root: string;
const sharedPath = () => path.join(root, '.taskgraph', 'config.json');
const localPath = () => path.join(root, '.taskgraph', 'config.local.json');
const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const writeJson = (file: string, data: unknown) =>
	fs.writeFileSync(file, JSON.stringify(data, null, 2));

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-config-local-'));
	fs.mkdirSync(path.join(root, '.taskgraph'));
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
	fs.rmSync(root, { recursive: true, force: true });
});

describe('writeConfig with config.local.json', () => {
	it('does not copy defaults into a locally overridden model role', () => {
		writeJson(sharedPath(), {
			models: { main: { provider: 'claude-code', modelId: 'sonnet' } }
		});
		writeJson(localPath(), { models: { main: { modelId: 'opus' } } });

		writeConfig(getConfig(root, true), root);

		expect(readJson(localPath())).toEqual({
			models: { main: { modelId: 'opus' } }
		});
	});

	it('leaves a broken config.local.json as it is', () => {
		writeJson(sharedPath(), {
			claudeCode: { pathToClaudeCodeExecutable: '/opt/claude/bin/claude' }
		});
		fs.writeFileSync(localPath(), '{ "models": ');

		expect(writeConfig(getConfig(root, true), root)).toBe(true);

		expect(fs.readFileSync(localPath(), 'utf-8')).toBe('{ "models": ');
		expect(readJson(sharedPath()).claudeCode).toEqual({
			pathToClaudeCodeExecutable: '/opt/claude/bin/claude'
		});
	});
});
