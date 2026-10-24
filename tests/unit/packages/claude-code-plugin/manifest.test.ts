/**
 * The plugin's manifest carries a version, so Claude Code shows it and
 * updates the plugin when it changes, and the taskgraph CLI range its
 * commands and hooks need. The release workflow bumps the version with
 * package.json (.github/scripts/version-bump.mjs), so the two stay equal.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimumVersion } from '@tm/core';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../..'
);
const readJson = (file: string) =>
	JSON.parse(fs.readFileSync(path.join(rootDir, file), 'utf8'));

const manifest = readJson(
	'packages/claude-code-plugin/.claude-plugin/plugin.json'
);
const pkg = readJson('package.json');
const marketplace = readJson('.claude-plugin/marketplace.json');

describe('plugin.json', () => {
	it('has the release version of package.json', () => {
		expect(manifest.version).toBe(pkg.version);
	});

	it('leaves the version out of the marketplace entry, so plugin.json decides', () => {
		const entry = marketplace.plugins.find(
			(plugin: { name: string }) => plugin.name === manifest.name
		);

		expect(entry).toBeDefined();
		expect(entry.version).toBeUndefined();
	});

	it('states the CLI range as a >=x.y.z minimum', () => {
		expect(minimumVersion(manifest.metadata.taskgraphCli)).not.toBeNull();
	});
});
