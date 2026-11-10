import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EnvironmentConfigProvider } from './environment-config-provider.service.js';
import { RuntimeStateManager } from './runtime-state-manager.service.js';
import {
	isTaskDataFenceOptOut,
	NO_TASK_DATA_FENCE_ENV,
	PROJECT_ENV_ALLOWLIST,
	readProjectEnv,
	shellDisablesTaskDataFence,
	shellEnvBeforeProject,
	shellRunsUnderClaudeCode
} from './project-env.js';

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

	it('does not take TASKGRAPH_NO_TASK_DATA_FENCE from a project .env (#929)', () => {
		delete process.env.TASKGRAPH_NO_TASK_DATA_FENCE;
		const env = readProjectEnv(
			projectWith(
				'TASKGRAPH_NO_TASK_DATA_FENCE=1\nTASKGRAPH_MODEL_MAIN=opus\nCLAUDE_CODE_API_KEY=secret\n'
			)
		);

		expect(env.TASKGRAPH_NO_TASK_DATA_FENCE).toBeUndefined();
		expect(env.CLAUDE_CODE_API_KEY).toBeUndefined();
		expect(env.TASKGRAPH_MODEL_MAIN).toBe('opus');
		expect(PROJECT_ENV_ALLOWLIST.shellOnly).toContain(NO_TASK_DATA_FENCE_ENV);
		expect(
			(PROJECT_ENV_ALLOWLIST.allow as readonly string[]).includes(
				NO_TASK_DATA_FENCE_ENV
			)
		).toBe(false);
	});

	it('takes the active tag from the env it is given', async () => {
		const root = projectWith();
		const manager = new RuntimeStateManager(root, { TASKGRAPH_TAG: 'feature' });

		await manager.loadState();

		expect(manager.getCurrentTag()).toBe('feature');
	});
});

describe('TASKGRAPH_NO_TASK_DATA_FENCE', () => {
	it('is on only for the exact shell value 1', () => {
		expect(isTaskDataFenceOptOut('1')).toBe(true);
		for (const value of [undefined, '', '0', 'true', 'TRUE', ' 1', '1 ']) {
			expect(isTaskDataFenceOptOut(value)).toBe(false);
		}
	});

	it('does not keep the rest of the process environment', () => {
		expect(process.env.PATH).toBeTruthy();
		expect(shellEnvBeforeProject('PATH')).toBeUndefined();
		expect(shellEnvBeforeProject('HOME')).toBeUndefined();
	});

	it('does not treat a Claude Code marker written after startup as one', () => {
		const previous = process.env.CLAUDECODE;
		process.env.CLAUDECODE = '1';

		expect(shellRunsUnderClaudeCode()).toBe(false);

		if (previous === undefined) delete process.env.CLAUDECODE;
		else process.env.CLAUDECODE = previous;
	});

	it('does not follow a process.env write made after the module loaded', () => {
		const previous = process.env.TASKGRAPH_NO_TASK_DATA_FENCE;
		process.env.TASKGRAPH_NO_TASK_DATA_FENCE = '0';
		const captured = shellDisablesTaskDataFence();
		process.env.TASKGRAPH_NO_TASK_DATA_FENCE = '1';

		expect(shellDisablesTaskDataFence()).toBe(captured);

		if (previous === undefined) delete process.env.TASKGRAPH_NO_TASK_DATA_FENCE;
		else process.env.TASKGRAPH_NO_TASK_DATA_FENCE = previous;
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

// The AI key lookup parsed the whole file for any name it was asked for (#1099)
describe('readers of a project .env', () => {
	const SRC = path.resolve(fileURLToPath(import.meta.url), '../../../..');
	const READS_ENV_FILE = /\bparseEnv\b|\bdotenv\b|['"`]\.env['"`]\s*\)/;

	it('are only project-env.ts, which keeps just the allowlisted names', () => {
		const readers = fs
			.readdirSync(SRC, { recursive: true, encoding: 'utf8' })
			.filter((file) => /\.ts$/.test(file) && !/\.(spec|test)\./.test(file))
			.filter((file) =>
				READS_ENV_FILE.test(fs.readFileSync(path.join(SRC, file), 'utf8'))
			)
			.map((file) => file.split(path.sep).join('/'));

		expect(readers).toEqual(['modules/config/services/project-env.ts']);
	});
});
