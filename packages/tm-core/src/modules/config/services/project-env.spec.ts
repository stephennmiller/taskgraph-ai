import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentConfigProvider } from './environment-config-provider.service.js';
import { RuntimeStateManager } from './runtime-state-manager.service.js';
import { readProjectEnv } from './project-env.js';

const projectWith = (envFile?: string): string => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-env-'));
	if (envFile !== undefined) fs.writeFileSync(path.join(dir, '.env'), envFile);
	return dir;
};

describe('project .env', () => {
	const saved = { ...process.env };

	beforeEach(() => {
		delete process.env.TASKGRAPH_MODEL_MAIN;
		delete process.env.TASKGRAPH_TAG;
	});

	afterEach(() => {
		process.env = { ...saved };
	});

	it('reads the project .env without touching process.env', () => {
		const env = readProjectEnv(projectWith('TASKGRAPH_MODEL_MAIN=opus\n'));

		expect(env.TASKGRAPH_MODEL_MAIN).toBe('opus');
		expect(process.env.TASKGRAPH_MODEL_MAIN).toBeUndefined();
	});

	it('lets a value already in process.env win over the file', () => {
		process.env.TASKGRAPH_MODEL_MAIN = 'sonnet';

		const env = readProjectEnv(projectWith('TASKGRAPH_MODEL_MAIN=opus\n'));

		expect(env.TASKGRAPH_MODEL_MAIN).toBe('sonnet');
	});

	it('works when the project has no .env', () => {
		expect(readProjectEnv(projectWith()).PATH).toBe(process.env.PATH);
	});

	it("keeps two projects from seeing each other's settings", () => {
		const a = readProjectEnv(projectWith('TASKGRAPH_MODEL_MAIN=opus\n'));
		const b = readProjectEnv(projectWith());

		expect(
			new EnvironmentConfigProvider(undefined, a).loadConfig().models?.main
		).toBe('opus');
		expect(
			new EnvironmentConfigProvider(undefined, b).loadConfig().models?.main
		).toBeUndefined();
	});

	it('takes the active tag from the env it is given', async () => {
		const root = projectWith();
		const manager = new RuntimeStateManager(root, { TASKGRAPH_TAG: 'feature' });

		await manager.loadState();

		expect(manager.getCurrentTag()).toBe('feature');
	});
});

describe('TASKGRAPH_RESPONSE_LANGUAGE', () => {
	it('sets global.responseLanguage, where lang writes it (#462)', () => {
		const config = new EnvironmentConfigProvider(undefined, {
			TASKGRAPH_RESPONSE_LANGUAGE: 'French'
		}).loadConfig();

		expect(config).toEqual({ global: { responseLanguage: 'French' } });
	});
});
