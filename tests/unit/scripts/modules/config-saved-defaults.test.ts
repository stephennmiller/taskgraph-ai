/**
 * #336: config saves wrote every merged default into config.json, so a
 * project that saved `defaultNumTasks: 10` kept asking for about 10 tasks after
 * the default became 0. Uses a real temp project; nothing is mocked.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	dropOldNumTasksDefault,
	toSavedConfig
} from '../../../../scripts/modules/config-file.js';
import {
	getConfig,
	getDefaultNumTasks,
	getUserId,
	writeConfig
} from '../../../../scripts/modules/config-manager.js';

// The init template (assets/config.json): no defaultNumTasks, no enableProxy
const TEMPLATE = JSON.parse(
	fs.readFileSync(
		new URL('../../../../assets/config.json', import.meta.url),
		'utf-8'
	)
);

// What the old save wrote: the template plus every global default of the time
const OLD_SAVED = {
	...TEMPLATE,
	global: {
		...TEMPLATE.global,
		defaultNumTasks: 10,
		enableCodebaseAnalysis: true,
		enableProxy: false,
		userId: '1234567890'
	},
	claudeCode: {}
};

let root: string;
let configPath: string;

const writeFile = (config: unknown) =>
	fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
const readFile = () => JSON.parse(fs.readFileSync(configPath, 'utf-8'));

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-config-336-'));
	fs.mkdirSync(path.join(root, '.taskgraph'));
	configPath = path.join(root, '.taskgraph', 'config.json');
});

afterEach(() => {
	fs.rmSync(root, { recursive: true, force: true });
});

describe('writeConfig only saves keys the project set (#336)', () => {
	it('does not add unchanged defaults when it saves the userId', () => {
		writeFile(TEMPLATE);

		getUserId(root);

		const global = readFile().global;
		expect(global.userId).toBe('1234567890');
		expect(global).not.toHaveProperty('defaultNumTasks');
		expect(global).not.toHaveProperty('enableProxy');
		expect(global).not.toHaveProperty('enableCodebaseAnalysis');
		expect(readFile()).not.toHaveProperty('claudeCode');
	});

	it('keeps keys the file has, even when they equal the default', () => {
		writeFile({ global: { defaultPriority: 'medium', defaultNumTasks: 0 } });
		const config = getConfig(root, true);
		config.global.responseLanguage = 'German';

		writeConfig(config, root);

		expect(readFile()).toEqual({
			global: {
				defaultPriority: 'medium',
				defaultNumTasks: 0,
				responseLanguage: 'German'
			}
		});
	});

	it('removes a key the caller deleted and keeps sections it does not read', () => {
		writeFile({
			models: { main: { modelId: 'opus', baseURL: 'http://old' } },
			storage: { type: 'file' }
		});
		const config = getConfig(root, true);
		delete config.models.main.baseURL;

		writeConfig(config, root);

		expect(readFile()).toEqual({
			models: { main: { modelId: 'opus', provider: 'claude-code' } },
			storage: { type: 'file' }
		});
	});
});

describe('model roles are saved with their provider', () => {
	it('keeps a fallback model whose provider equals the default', () => {
		writeFile({ global: { defaultPriority: 'medium' } });
		const config = getConfig(root, true);
		config.models.fallback = { ...config.models.fallback, modelId: 'opus' };

		writeConfig(config, root);

		expect(readFile().models.fallback).toEqual({
			provider: 'claude-code',
			modelId: 'opus'
		});
		expect(getConfig(root, true).models.fallback.modelId).toBe('opus');
	});
});

describe('a defaultNumTasks: 10 saved by the old default (#336)', () => {
	it('is dropped on load, so parse-prd sizes the list to the PRD', () => {
		writeFile(OLD_SAVED);

		expect(getDefaultNumTasks(root)).toBe(0);
		getConfig(root, true);

		const global = readFile().global;
		expect(global).not.toHaveProperty('defaultNumTasks');
		expect(global).not.toHaveProperty('enableProxy');
		expect(global.userId).toBe('1234567890');
		expect(global.enableCodebaseAnalysis).toBe(true);
	});

	it('keeps a 10 the user sets after the cleanup', () => {
		writeFile(OLD_SAVED);
		getConfig(root, true);
		writeFile({
			...readFile(),
			global: { ...readFile().global, defaultNumTasks: 10 }
		});
		getConfig(root, true);

		expect(getDefaultNumTasks(root)).toBe(10);
		getUserId(root);
		expect(readFile().global.defaultNumTasks).toBe(10);
		expect(getConfig(root, true).global.defaultNumTasks).toBe(10);
	});

	it('keeps a 10 in a file the old save did not write', () => {
		writeFile({
			...TEMPLATE,
			global: { ...TEMPLATE.global, defaultNumTasks: 10 }
		});

		expect(getDefaultNumTasks(root)).toBe(10);
		expect(readFile().global.defaultNumTasks).toBe(10);
	});

	it('keeps any other saved count', () => {
		writeFile({
			...OLD_SAVED,
			global: { ...OLD_SAVED.global, defaultNumTasks: 12 }
		});

		expect(getDefaultNumTasks(root)).toBe(12);
		expect(readFile().global.enableProxy).toBe(false);
	});
});

describe('config-file helpers', () => {
	it('toSavedConfig leaves out nested defaults the file does not have', () => {
		const defaults = {
			global: { a: 1, b: 1 },
			models: { main: { provider: 'p', modelId: 'm', maxTokens: 1 } }
		};
		const config = {
			global: { a: 1, b: 2 },
			models: { main: { provider: 'p', modelId: 'm', maxTokens: 2 } }
		};

		expect(toSavedConfig(config, null, defaults)).toEqual({
			global: { b: 2 },
			models: { main: { provider: 'p', modelId: 'm', maxTokens: 2 } }
		});
	});

	it('dropOldNumTasksDefault leaves files without the old save alone', () => {
		expect(dropOldNumTasksDefault({ global: { defaultNumTasks: 10 } })).toBe(
			null
		);
		expect(dropOldNumTasksDefault({})).toBe(null);
	});
});
