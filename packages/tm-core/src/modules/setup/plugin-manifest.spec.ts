import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkCliForPlugin, readPluginManifest } from './plugin-manifest.js';

const dirs: string[] = [];

/** A plugin folder whose manifest is `manifest` (a string is written as is) */
function plugin(manifest: object | string): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-plugin-'));
	dirs.push(root);
	fs.mkdirSync(path.join(root, '.claude-plugin'));
	fs.writeFileSync(
		path.join(root, '.claude-plugin', 'plugin.json'),
		typeof manifest === 'string' ? manifest : JSON.stringify(manifest)
	);
	return root;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe('readPluginManifest', () => {
	it('reads the version and the CLI range', () => {
		const root = plugin({
			version: '0.58.0',
			metadata: { taskgraphCli: '>=0.57.2' }
		});

		expect(readPluginManifest(root)).toEqual({
			version: '0.58.0',
			cliRange: '>=0.57.2'
		});
	});

	it('returns null when there is no manifest or it is not JSON', () => {
		expect(readPluginManifest(path.join(os.tmpdir(), 'tg-no-plugin'))).toBe(
			null
		);
		expect(readPluginManifest(plugin('{ nope'))).toBeNull();
	});
});

describe('checkCliForPlugin', () => {
	it('passes a CLI that meets the range', () => {
		const root = plugin({ metadata: { taskgraphCli: '>=0.57.2' } });

		expect(checkCliForPlugin(root, '0.57.2')).toEqual({ ok: true });
	});

	it('names both versions when the CLI is too old', () => {
		const root = plugin({ metadata: { taskgraphCli: '>=0.57.2' } });

		expect(checkCliForPlugin(root, '0.54.22')).toEqual({
			ok: false,
			cliVersion: '0.54.22',
			cliRange: '>=0.57.2'
		});
	});

	it('passes when the plugin states no range, or has no manifest', () => {
		expect(checkCliForPlugin(plugin({ version: '1.0.0' }), '0.1.0')).toEqual({
			ok: true
		});
		expect(
			checkCliForPlugin(path.join(os.tmpdir(), 'tg-none'), '0.1.0')
		).toEqual({ ok: true });
	});
});
