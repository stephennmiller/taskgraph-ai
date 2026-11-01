import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkForUpdate, readCache, writeCache } from './check-update.js';

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
		vi.restoreAllMocks();
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

	/** The registry can't be reached: every request fails */
	const failEveryRequest = () =>
		vi.spyOn(https, 'request').mockImplementation((() => {
			const req = new EventEmitter() as EventEmitter & { end: () => void };
			req.end = () =>
				setImmediate(() => req.emit('error', new Error('ETIMEDOUT')));
			return req;
		}) as never);

	it('caches a failed registry check, so the next command skips the network', async () => {
		const request = failEveryRequest();

		expect((await checkForUpdate('1.0.0')).needsUpdate).toBe(false);
		expect((await checkForUpdate('1.0.0')).needsUpdate).toBe(false);

		expect(request).toHaveBeenCalledTimes(1);
		// One deadline for the whole request, connecting included
		expect(request.mock.calls[0][0]).toHaveProperty('signal');
		expect(readCache()).toMatchObject({ latestVersion: '1.0.0' });
	});

	it('retries a failed check after 10 minutes, a good one after an hour', () => {
		const elevenMinutesAgo = Date.now() - 11 * 60 * 1000;

		write({
			timestamp: elevenMinutesAgo,
			latestVersion: '1.2.3',
			failed: true
		});
		expect(readCache()).toBeNull();

		write({ timestamp: elevenMinutesAgo, latestVersion: '1.2.3' });
		expect(readCache()).toMatchObject({ latestVersion: '1.2.3' });
	});

	it('asks the registry on a fresh check despite a cached failure, and says it failed', async () => {
		write({ timestamp: Date.now(), latestVersion: '1.0.0', failed: true });
		const request = failEveryRequest();

		const info = await checkForUpdate('1.0.0', { fresh: true });

		expect(request).toHaveBeenCalledTimes(1);
		expect(info).toMatchObject({ needsUpdate: false, failed: true });
	});

	it('keeps a good cached version when a fresh check fails', async () => {
		write({ timestamp: Date.now(), latestVersion: '2.0.0' });
		failEveryRequest();

		const info = await checkForUpdate('1.0.0', { fresh: true });

		expect(info).toMatchObject({ needsUpdate: false, failed: true });
		expect(readCache()).toMatchObject({ latestVersion: '2.0.0' });
		expect((await checkForUpdate('1.0.0')).needsUpdate).toBe(true);
	});

	/** The registry answers 200 with this body */
	const replyWith = (body: unknown) =>
		vi.spyOn(https, 'request').mockImplementation(((
			_options: unknown,
			onResponse: (res: EventEmitter & { statusCode: number }) => void
		) => {
			const req = new EventEmitter() as EventEmitter & { end: () => void };
			req.end = () =>
				setImmediate(() => {
					const res = Object.assign(new EventEmitter(), { statusCode: 200 });
					onResponse(res);
					res.emit('data', JSON.stringify(body));
					res.emit('end');
				});
			return req;
		}) as never);

	it.each([
		['a non-semver string', 'latest; rm -rf /'],
		['a version with an install spec after it', '99.0.0@git+https://x.test/y'],
		['a version with a trailing newline', '2.0.0\n'],
		['a version with an escape sequence', '2.0.0-\u001b[2J'],
		['a v-prefixed version', 'v2.0.0'],
		['a number', 2],
		['an object', { version: '2.0.0' }]
	])(
		'counts a dist-tags.latest that is %s as a failed check',
		async (_, latest) => {
			replyWith({ 'dist-tags': { latest } });

			const info = await checkForUpdate('1.0.0', { fresh: true });

			expect(info).toMatchObject({
				latestVersion: '1.0.0',
				needsUpdate: false,
				failed: true
			});
		}
	);

	it('takes a semver dist-tags.latest from the registry', async () => {
		replyWith({ 'dist-tags': { latest: '1.0.1' } });

		const info = await checkForUpdate('1.0.1', { fresh: true });

		expect(info).toMatchObject({ latestVersion: '1.0.1', needsUpdate: false });
		expect(info.failed).toBeUndefined();
	});

	it('gives up when the registry sends headers and then stalls the body', async () => {
		const server = http.createServer((_req, res) => {
			res.writeHead(200);
			res.write('{"dist-tags":');
		});
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve)
		);
		const { port } = server.address() as AddressInfo;
		// A real socket on localhost, with a short deadline in place of 3 seconds
		vi.spyOn(https, 'request').mockImplementation(((
			options: http.RequestOptions,
			onResponse: (res: http.IncomingMessage) => void
		) =>
			http.request(
				{
					...options,
					hostname: '127.0.0.1',
					port,
					signal: AbortSignal.timeout(100)
				},
				onResponse
			)) as never);

		try {
			const info = await checkForUpdate('1.0.0', { fresh: true });
			expect(info).toMatchObject({ needsUpdate: false, failed: true });
		} finally {
			server.closeAllConnections();
			server.close();
		}
	});
});
