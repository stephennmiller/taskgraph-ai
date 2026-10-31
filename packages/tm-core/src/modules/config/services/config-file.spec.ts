import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	dropOldNumTasksDefault,
	readLogLevel,
	toSavedConfig,
	writeSplitConfig
} from './config-file.js';

let root: string;
const write = (file: string, text: string) =>
	fs.writeFileSync(path.join(root, '.taskgraph', file), text);

beforeEach(() => {
	root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-config-file-'));
	fs.mkdirSync(path.join(root, '.taskgraph'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('readLogLevel', () => {
	it("is 'info' without a config", () => {
		expect(readLogLevel(root)).toBe('info');
	});

	it("reads config.json's level, lower-cased", () => {
		write('config.json', JSON.stringify({ global: { logLevel: 'WARN' } }));

		expect(readLogLevel(root)).toBe('warn');
	});

	it('takes config.local.json over config.json', () => {
		write('config.json', JSON.stringify({ global: { logLevel: 'warn' } }));
		write(
			'config.local.json',
			JSON.stringify({ global: { logLevel: 'debug' } })
		);

		expect(readLogLevel(root)).toBe('debug');
	});

	it('skips a file that is not valid JSON', () => {
		write('config.json', '{ not json');
		write(
			'config.local.json',
			JSON.stringify({ global: { logLevel: 'error' } })
		);

		expect(readLogLevel(root)).toBe('error');
	});
});

// Moved from the legacy config-manager tests (#336)
describe('toSavedConfig', () => {
	const defaults = {
		global: { a: 1, b: 1 },
		models: { main: { provider: 'p', modelId: 'm', maxTokens: 1 } }
	};

	it('leaves out nested defaults the file does not have', () => {
		const config = {
			global: { a: 1, b: 2 },
			models: { main: { provider: 'p', modelId: 'm', maxTokens: 2 } }
		};

		expect(toSavedConfig(config, null, defaults)).toEqual({
			global: { b: 2 },
			models: { main: { maxTokens: 2 } }
		});
		config.models.main.modelId = 'n';
		expect(toSavedConfig(config, null, defaults).models).toEqual({
			main: { provider: 'p', modelId: 'n', maxTokens: 2 }
		});
	});

	it("keeps the file's keys, their order and sections it doesn't know", () => {
		const saved = { storage: { type: 'file' }, global: { b: 1, a: 1 } };
		const config = { global: { a: 1, b: 1 }, models: defaults.models };

		const out = toSavedConfig(config, saved, defaults);

		expect(out).toEqual({ storage: { type: 'file' }, global: { b: 1, a: 1 } });
		expect(Object.keys(out.global as object)).toEqual(['b', 'a']);
	});
});

describe('dropOldNumTasksDefault', () => {
	it('drops the 10 and enableProxy the old save wrote together', () => {
		expect(
			dropOldNumTasksDefault({
				global: { defaultNumTasks: 10, enableProxy: false, userId: 'u' }
			})
		).toEqual({ global: { userId: 'u' } });
	});

	it('leaves files without the old save alone', () => {
		expect(dropOldNumTasksDefault({ global: { defaultNumTasks: 10 } })).toBe(
			null
		);
		expect(
			dropOldNumTasksDefault({
				global: { defaultNumTasks: 12, enableProxy: false }
			})
		).toBe(null);
		expect(dropOldNumTasksDefault({})).toBe(null);
	});
});

describe('writeSplitConfig', () => {
	it.skipIf(process.platform === 'win32')(
		'refuses a .taskgraph folder that is a symlink (#782)',
		() => {
			const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-elsewhere-'));
			const linked = path.join(root, 'linked');
			fs.mkdirSync(linked);
			fs.symlinkSync(elsewhere, path.join(linked, '.taskgraph'));
			try {
				expect(() => writeSplitConfig(linked, { models: {} })).toThrow(
					/symlink/
				);
				expect(fs.readdirSync(elsewhere)).toEqual([]);
			} finally {
				fs.rmSync(elsewhere, { recursive: true, force: true });
			}
		}
	);

	it
		.skipIf(process.platform === 'win32')
		.each(['config.json', 'config.local.json'])(
		'refuses to write through a symlinked %s',
		(file) => {
			const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-elsewhere-'));
			const target = path.join(elsewhere, 'settings.json');
			fs.writeFileSync(target, '{"keep":true}');
			fs.symlinkSync(target, path.join(root, '.taskgraph', file));
			try {
				expect(() =>
					writeSplitConfig(root, {
						models: { main: { provider: 'openai', modelId: 'gpt-5' } }
					})
				).toThrow(/symlink/);
				expect(fs.readFileSync(target, 'utf8')).toBe('{"keep":true}');
			} finally {
				fs.rmSync(elsewhere, { recursive: true, force: true });
			}
		}
	);

	it('writes regular config files', () => {
		writeSplitConfig(root, {
			models: { main: { provider: 'openai', modelId: 'gpt-5' } }
		});

		const saved = JSON.parse(
			fs.readFileSync(path.join(root, '.taskgraph', 'config.json'), 'utf8')
		);
		expect(saved.models.main).toMatchObject({
			provider: 'openai',
			modelId: 'gpt-5'
		});
	});
});
