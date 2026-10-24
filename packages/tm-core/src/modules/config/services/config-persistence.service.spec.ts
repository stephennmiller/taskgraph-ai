import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigLoader } from './config-loader.service.js';
import { ConfigPersistence } from './config-persistence.service.js';

describe('ConfigPersistence.deleteConfig', () => {
	let projectRoot: string;

	beforeEach(() => {
		projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-persist-'));
		fs.mkdirSync(path.join(projectRoot, '.taskgraph'));
	});

	afterEach(() => {
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	it('removes config.json and config.local.json so reset returns to defaults (#461)', async () => {
		fs.writeFileSync(
			path.join(projectRoot, '.taskgraph', 'config.json'),
			JSON.stringify({ global: { projectName: 'p' } })
		);
		fs.writeFileSync(
			path.join(projectRoot, '.taskgraph', 'config.local.json'),
			JSON.stringify({ models: { main: { modelId: 'local-model' } } })
		);

		await new ConfigPersistence(projectRoot).deleteConfig();

		expect(fs.readdirSync(path.join(projectRoot, '.taskgraph'))).toEqual([]);
		expect(await new ConfigLoader(projectRoot).loadLocalConfig()).toBeNull();
	});

	it('succeeds when neither file exists', async () => {
		await expect(
			new ConfigPersistence(projectRoot).deleteConfig()
		).resolves.toBeUndefined();
	});
});
