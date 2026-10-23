import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigPersistence } from './config-persistence.service.js';

const EXECUTABLE = '/opt/claude/bin/claude';

describe('ConfigPersistence.saveConfig', () => {
	let root: string;
	const sharedPath = () => path.join(root, '.taskgraph', 'config.json');
	const localPath = () => path.join(root, '.taskgraph', 'config.local.json');
	const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-config-persist-'));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	it('writes only config.json when nothing is per-machine', async () => {
		await new ConfigPersistence(root).saveConfig({
			models: { main: { modelId: 'opus' } }
		} as never);

		expect(read(sharedPath())).toEqual({
			models: { main: { modelId: 'opus' } }
		});
		expect(fs.existsSync(localPath())).toBe(false);
	});

	it('puts the claude executable path in config.local.json', async () => {
		await new ConfigPersistence(root).saveConfig({
			global: { logLevel: 'info' },
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		} as never);

		expect(read(sharedPath())).toEqual({ global: { logLevel: 'info' } });
		expect(read(localPath())).toEqual({
			claudeCode: { pathToClaudeCodeExecutable: EXECUTABLE }
		});
	});

	it('keeps a local override local and config.json as it was', async () => {
		fs.mkdirSync(path.join(root, '.taskgraph'));
		fs.writeFileSync(
			sharedPath(),
			JSON.stringify({ models: { main: { modelId: 'sonnet' } } })
		);
		fs.writeFileSync(
			localPath(),
			JSON.stringify({ models: { main: { modelId: 'opus' } } })
		);

		await new ConfigPersistence(root).saveConfig({
			models: { main: { modelId: 'haiku' } }
		} as never);

		expect(read(sharedPath())).toEqual({
			models: { main: { modelId: 'sonnet' } }
		});
		expect(read(localPath())).toEqual({
			models: { main: { modelId: 'haiku' } }
		});
	});
});
