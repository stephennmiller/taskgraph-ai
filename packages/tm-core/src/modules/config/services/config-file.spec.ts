import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readLogLevel } from './config-file.js';

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
