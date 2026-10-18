/**
 * Guards the package identity: the package, its auto-updater and its dev
 * tooling must refer to TaskGraph only, and the source must not fall back to
 * the previous project name.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const read = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

// Built from fragments so this file does not contain the old name itself.
const PREVIOUS_NAME = new RegExp(['task', '[-_ ]?', 'master'].join(''), 'i');

// Files where the package name or repo owner does real work at runtime
// (registry lookups, installs, root detection, MCP launch, release links).
const IDENTITY_FILES = [
	'package.json',
	'.changeset/config.json',
	'.github/scripts/utils.mjs',
	'.github/scripts/check-pre-release-mode.mjs',
	'apps/cli/src/utils/auto-update/changelog.ts',
	'apps/cli/src/utils/auto-update/constants.ts',
	'apps/cli/src/utils/auto-update/check-update.ts',
	'apps/cli/src/utils/auto-update/download.ts',
	'apps/cli/src/utils/auto-update/index.ts',
	'apps/cli/src/utils/auto-update/install.ts',
	'apps/cli/src/utils/auto-update/restart.ts',
	'apps/cli/src/ui/components/brand-banner.component.ts',
	'.mcp.json',
	'apps/mcp/src/shared/utils.ts',
	'packages/tm-core/src/common/constants/index.ts',
	'packages/tm-core/src/modules/loop/presets/default.ts',
	'packages/tm-profiles/src/slash-commands/commands/solo/install-taskgraph.ts',
	'packages/tm-profiles/src/slash-commands/commands/solo/quick-install-taskgraph.ts',
	'mcp-server/src/tools/utils.js',
	'scripts/loop.sh',
	'scripts/modules/commands.js',
	'src/utils/asset-resolver.js',
	'src/utils/create-mcp-config.js'
];

const SOURCE_DIRS = [
	'scripts',
	'src',
	'mcp-server/src',
	'apps/cli/src',
	'apps/mcp/src',
	'packages/tm-core/src',
	'packages/tm-profiles/src'
];

const listSourceFiles = (dir) =>
	fs
		.readdirSync(path.join(rootDir, dir), { withFileTypes: true })
		.flatMap((entry) => {
			const rel = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				return entry.name === 'node_modules' ? [] : listSourceFiles(rel);
			}
			return /\.(js|mjs|ts|tsx|sh)$/.test(entry.name) ? [rel] : [];
		});

describe('package identity', () => {
	const pkg = JSON.parse(read('package.json'));

	test('package is published as taskgraph-ai', () => {
		expect(pkg.name).toBe('taskgraph-ai');
	});

	test('ships the taskgraph binaries', () => {
		expect(Object.keys(pkg.bin).sort()).toEqual([
			'taskgraph',
			'taskgraph-ai',
			'taskgraph-mcp'
		]);
	});

	test('`npx -y taskgraph-ai` launches the MCP server', () => {
		// npx runs the bin named like the package, and generated MCP configs rely on it
		expect(pkg.bin[pkg.name]).toBe('dist/mcp-server.js');
		expect(pkg.bin['taskgraph-mcp']).toBe(pkg.bin[pkg.name]);
	});

	test('repository, homepage and bugs point at this repo', () => {
		expect(pkg.repository.url).toContain('stephennmiller/');
		expect(pkg.homepage).toContain('stephennmiller/');
		expect(pkg.bugs.url).toContain('stephennmiller/');
	});

	test('auto-updater re-spawns a binary the package actually ships', () => {
		const constants = read('apps/cli/src/utils/auto-update/constants.ts');
		const binName = constants.match(/BIN_NAME = '([^']+)'/)[1];
		expect(Object.keys(pkg.bin)).toContain(binName);
	});

	test('auto-updater queries the same package it ships as', () => {
		expect(read('apps/cli/src/utils/auto-update/constants.ts')).toContain(
			`PACKAGE_NAME = '${pkg.name}'`
		);
	});

	test.each(IDENTITY_FILES)('%s does not use the previous name', (file) => {
		expect(read(file)).not.toMatch(PREVIOUS_NAME);
	});

	test('source does not use the previous name', () => {
		const offenders = SOURCE_DIRS.flatMap(listSourceFiles).flatMap((file) =>
			read(file)
				.split('\n')
				.map((text, i) => ({ file, line: i + 1, text }))
				.filter(({ text }) => PREVIOUS_NAME.test(text))
				.map(({ file, line }) => `${file}:${line}`)
		);

		expect(offenders).toEqual([]);
	});
});
