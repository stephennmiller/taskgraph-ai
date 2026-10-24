import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigManager } from './config-manager.js';

const projectWith = (envFile: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-cm-env-'));
	fs.writeFileSync(path.join(dir, '.env'), envFile);
	return dir;
};

describe('ConfigManager project .env', () => {
	const saved = { ...process.env };

	afterEach(() => {
		process.env = { ...saved };
	});

	it('applies the .env of its own project only', async () => {
		delete process.env.TASKGRAPH_MODEL_MAIN;
		const withModel = await ConfigManager.create(
			projectWith('TASKGRAPH_MODEL_MAIN=opus\n')
		);
		const without = await ConfigManager.create(projectWith('FOO=bar\n'));

		expect(withModel.getModelConfig().main).toBe('opus');
		expect(without.getModelConfig().main).not.toBe('opus');
		expect(process.env.TASKGRAPH_MODEL_MAIN).toBeUndefined();
	});

	it('lets TASKGRAPH_RESPONSE_LANGUAGE override the config file (#547)', async () => {
		const dir = projectWith('');
		fs.mkdirSync(path.join(dir, '.taskgraph'));
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'config.json'),
			JSON.stringify({ global: { responseLanguage: 'German' } })
		);
		process.env.TASKGRAPH_RESPONSE_LANGUAGE = 'French';

		const manager = await ConfigManager.create(dir);

		expect(manager.getResponseLanguage()).toBe('French');
	});
});
