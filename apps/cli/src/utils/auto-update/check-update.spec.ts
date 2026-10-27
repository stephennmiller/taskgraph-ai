import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCache, writeCache } from './check-update.js';

describe('update cache', () => {
	const savedHome = process.env.HOME;
	const savedCwd = process.cwd();
	let home: string;
	const cacheFile = () => path.join(home, '.taskgraph', 'update-cache.json');
	const write = (cache: unknown) => {
		fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
		fs.writeFileSync(cacheFile(), JSON.stringify(cache));
	};

	beforeEach(() => {
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-cache-'));
		process.env.HOME = home;
	});

	afterEach(() => {
		if (savedHome === undefined) delete process.env.HOME;
		else process.env.HOME = savedHome;
		process.chdir(savedCwd);
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('writes under ~/.taskgraph, creating the folder, and reads it back', () => {
		writeCache('1.2.3', ['Feature']);

		expect(fs.existsSync(cacheFile())).toBe(true);
		expect(readCache()).toMatchObject({
			latestVersion: '1.2.3',
			highlights: ['Feature']
		});
	});

	it('ignores a cache whose version is not semver', () => {
		write({ timestamp: Date.now(), latestVersion: 'latest; rm -rf /' });
		expect(readCache()).toBeNull();

		write({ timestamp: Date.now(), latestVersion: 7 });
		expect(readCache()).toBeNull();
	});

	it('ignores a cache whose timestamp is in the future or expired', () => {
		write({ timestamp: Date.now() + 60_000, latestVersion: '1.2.3' });
		expect(readCache()).toBeNull();

		write({
			timestamp: Date.now() - 2 * 60 * 60 * 1000,
			latestVersion: '1.2.3'
		});
		expect(readCache()).toBeNull();

		write({ timestamp: 'soon', latestVersion: '1.2.3' });
		expect(readCache()).toBeNull();
	});

	it('drops highlights that are not strings and returns null with no file', () => {
		expect(readCache()).toBeNull();

		write({ timestamp: Date.now(), latestVersion: '1.2.3', highlights: 'x' });
		expect(readCache()?.highlights).toBeUndefined();
	});

	it('touches nothing in the working directory when HOME is empty', () => {
		process.chdir(home);
		process.env.HOME = '';

		writeCache('1.2.3');

		expect(fs.existsSync(path.join(home, '.taskgraph'))).toBe(false);
		expect(readCache()).toBeNull();
	});

	it('keeps a write failure silent', () => {
		fs.writeFileSync(path.join(home, '.taskgraph'), 'not a directory');
		expect(() => writeCache('1.2.3')).not.toThrow();
	});
});
