/**
 * Guards the fork's package identity: the package must not point itself, its
 * auto-updater, or its dev tooling back at upstream's `task-master-ai`.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const read = (relPath) => fs.readFileSync(path.join(rootDir, relPath), 'utf8');

const OLD_PACKAGE = 'task-master-ai';
// Upstream's repo and GitHub paths; the author's x.com credit in the banner is
// attribution, not wiring, and is intentionally kept.
const OLD_REPO_PATHS = [
	'eyaltoledano/claude-task-master',
	'github.com/eyaltoledano'
];

// Files where the package name or repo owner does real work at runtime
// (registry lookups, installs, root detection, MCP launch, release links).
const IDENTITY_FILES = [
	'package.json',
	'manifest.json',
	'.changeset/config.json',
	'.github/scripts/utils.mjs',
	'.github/scripts/check-pre-release-mode.mjs',
	'apps/cli/src/utils/auto-update/changelog.ts',
	'apps/cli/src/utils/auto-update/constants.ts',
	'apps/cli/src/utils/auto-update/check-update.ts',
	'apps/cli/src/utils/auto-update/download.ts',
	'apps/cli/src/utils/auto-update/index.ts',
	'apps/cli/src/utils/auto-update/install.ts',
	'apps/cli/src/ui/components/brand-banner.component.ts',
	'apps/extension/package.json',
	'apps/extension/package.publish.json',
	'apps/extension/src/utils/configManager.ts',
	'apps/extension/src/utils/errorHandler.ts',
	'apps/extension/src/utils/mcpClient.ts',
	'.mcp.json',
	'.kiro/settings/mcp.json',
	'.cursor/mcp.json',
	'packages/claude-code-plugin/mcp.json',
	'apps/mcp/src/shared/utils.ts',
	'packages/tm-core/src/common/constants/index.ts',
	'packages/tm-core/src/modules/loop/presets/default.ts',
	'packages/tm-profiles/src/slash-commands/commands/solo/install-taskmaster.ts',
	'packages/tm-profiles/src/slash-commands/commands/solo/quick-install-taskmaster.ts',
	'scripts/loop.sh',
	'src/utils/asset-resolver.js',
	'src/utils/create-mcp-config.js',
	'src/profiles/amp.js',
	'src/profiles/roo.js',
	'src/profiles/vscode.js',
	'src/profiles/zed.js'
];

// Places where the CLI refers to itself by binary name at runtime (re-spawning
// after an update, the MCP CLI fallback, commander's program name).
const SELF_REFERENCING_FILES = [
	'apps/cli/src/utils/auto-update/restart.ts',
	'mcp-server/src/tools/utils.js',
	'index.js',
	'scripts/modules/commands.js'
];

describe('package identity', () => {
	const pkg = JSON.parse(read('package.json'));

	test('package is published as taskgraph-ai', () => {
		expect(pkg.name).toBe('taskgraph-ai');
	});

	test('binaries do not clash with upstream task-master binaries', () => {
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

	test('repository, homepage and bugs point at the fork', () => {
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

	test.each(IDENTITY_FILES)(
		'%s does not reference upstream identity',
		(file) => {
			const content = read(file);
			expect(content).not.toContain(OLD_PACKAGE);
			for (const oldPath of OLD_REPO_PATHS) {
				expect(content).not.toContain(oldPath);
			}
		}
	);

	test.each(SELF_REFERENCING_FILES)(
		'%s does not call the CLI by upstream binary name',
		(file) => {
			expect(read(file)).not.toMatch(/['"`]task-master['"`]/);
		}
	);

	describe('user-facing messages', () => {
		// Bare `task-master` as a command, not part of a file name, path, hyphenated name or URL
		const BARE_COMMAND = /(?<![\w./@:<-])task-master(?![\w\-/:]|\.\w)/;
		// Quoted identifiers (`'task-master'`) are code, not messages
		const QUOTED = /(['"`])task-master\1/;
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

		test('source tells users to run taskgraph, not task-master', () => {
			const offenders = SOURCE_DIRS.flatMap(listSourceFiles).flatMap((file) =>
				read(file)
					.split('\n')
					.map((line, i) => ({ file, line: i + 1, text: line }))
					// scripts/init.js still cleans up aliases written by earlier installs
					.filter(({ text }) => !/hamster|ham=/.test(text))
					.filter(({ text }) => BARE_COMMAND.test(text) && !QUOTED.test(text))
					.map(({ file, line }) => `${file}:${line}`)
			);

			expect(offenders).toEqual([]);
		});
	});
});
