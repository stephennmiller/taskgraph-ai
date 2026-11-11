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

describe('taskgraph-hooks plugin.json', () => {
	const hooks = readJson(
		'packages/claude-code-hooks/.claude-plugin/plugin.json'
	);

	it('has the version and CLI range of the taskgraph plugin', () => {
		expect(hooks.version).toBe(manifest.version);
		expect(hooks.metadata.taskgraphCli).toBe(manifest.metadata.taskgraphCli);
	});

	it('is in the marketplace', () => {
		expect(
			marketplace.plugins.map((plugin: { name: string }) => plugin.name)
		).toContain(hooks.name);
	});
});

// The Claude plugin directory refuses these from an unverified org
describe('the taskgraph plugin passes the directory policy', () => {
	const pluginDir = path.join(rootDir, 'packages/claude-code-plugin');
	const files = fs
		.readdirSync(pluginDir, { recursive: true, encoding: 'utf8' })
		.filter((file) => fs.statSync(path.join(pluginDir, file)).isFile());

	it('ships no hooks', () => {
		expect(files.filter((file) => file.startsWith('hooks'))).toEqual([]);
		expect(manifest.hooks).toBeUndefined();
	});

	it('ships only Markdown, JSON, YAML, text and images, none starting with #!', () => {
		const allowed =
			/(\.(md|json|ya?ml|txt|png|jpe?g|gif|webp|ico)|^\.gitignore|\/\.gitignore)$/;
		expect(files.filter((file) => !allowed.test(file))).toEqual([]);
		expect(
			files.filter((file) => /package\.json$|pnpm-workspace\.yaml$/.test(file))
		).toEqual([]);
		expect(
			files.filter((file) =>
				fs
					.readFileSync(path.join(pluginDir, file))
					.subarray(0, 2)
					.equals(Buffer.from('#!'))
			)
		).toEqual([]);
	});

	it('pre-approves no tools beyond Read, Grep, Glob and LS', () => {
		const grants = files
			.filter((file) => file.endsWith('.md'))
			.flatMap((file) =>
				[
					...fs
						.readFileSync(path.join(pluginDir, file), 'utf8')
						.matchAll(/^allowed-?[tT]ools:(.*)$/gm)
				].flatMap((m) => m[1].split(/[\s,]+/).filter(Boolean))
			);
		expect(
			grants.filter((tool) => !['Read', 'Grep', 'Glob', 'LS'].includes(tool))
		).toEqual([]);
	});
});
