import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const commandsDir = join(repoRoot, 'packages/claude-code-plugin/commands');

/**
 * Slash commands that were merged or renamed (#170, #171, #244) or never existed.
 * They must not be referenced anywhere: there are no aliases.
 */
const REMOVED_COMMANDS = [
	'list-tasks-by-status',
	'list-tasks-with-subtasks',
	'init-project-quick',
	'quick-install-taskgraph',
	'update-single-task',
	'to-pending',
	'to-review',
	'to-deferred',
	'to-cancelled',
	'remove-subtasks',
	'remove-all-subtasks',
	'clear-all-subtasks',
	'generate-tasks',
	'analyze-project'
];

/** Slash-command prefixes that no longer exist: the plugin namespace is /taskgraph: */
const REMOVED_PREFIXES = ['/tm:', '/project:'];

// Files that record history or exist to forbid the names
const ALLOWED_FILES = new Set([
	'package-lock.json',
	'apps/docs/upgrading.mdx',
	// The frozen list of names older inits wrote, which the cleanup removes
	'tests/unit/profiles/claude-no-slash-commands.test.js',
	'packages/tm-profiles/src/legacy-commands.ts',
	'packages/tm-profiles/src/legacy-commands.spec.ts',
	'packages/tm-profiles/tests/integration/stale-command-names.test.ts'
]);

const TEXT_FILE = /\.(ts|tsx|js|mjs|cjs|md|json|mdx|yml|yaml|txt|sh)$/;

// Tracked files only, so untracked local files and worktrees cannot trip it
function listTrackedFiles(): string[] {
	return execFileSync('git', ['ls-files', '-z'], {
		cwd: repoRoot,
		encoding: 'utf-8',
		maxBuffer: 64 * 1024 * 1024
	})
		.split('\0')
		.filter(
			(file) =>
				file &&
				TEXT_FILE.test(file) &&
				basename(file) !== 'CHANGELOG.md' &&
				existsSync(join(repoRoot, file))
		);
}

// Not preceded or followed by a word character or hyphen, so that
// `update-single-task-status` or `to-review-queue` do not match
const nameRegex = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`);

describe('removed slash commands', () => {
	const files = listTrackedFiles()
		.filter((file) => !ALLOWED_FILES.has(file))
		.map((file) => ({
			file,
			text: readFileSync(join(repoRoot, file), 'utf-8')
		}));

	it('finds files to scan', () => {
		expect(files.length).toBeGreaterThan(100);
	});

	it.each(REMOVED_COMMANDS)('%s is not referenced', (name) => {
		const matcher = nameRegex(name);
		const offenders = files
			.filter(({ text }) => matcher.test(text))
			.map(({ file }) => file);

		expect(offenders).toEqual([]);
	});

	it.each(REMOVED_PREFIXES)('the %s prefix is not used', (prefix) => {
		const offenders = files
			.filter(({ text }) => text.includes(prefix))
			.map(({ file }) => file);

		expect(offenders).toEqual([]);
	});
});

describe('plugin command bodies', () => {
	const commandFiles = readdirSync(commandsDir).filter((file) =>
		file.endsWith('.md')
	);
	const commandNames = new Set(commandFiles.map((file) => file.slice(0, -3)));

	it.each(commandFiles)(
		'%s only refers to existing /taskgraph: commands',
		(file) => {
			const text = readFileSync(join(commandsDir, file), 'utf-8');
			const referenced = [...text.matchAll(/\/taskgraph:([a-z][a-z-]*)/g)].map(
				(match) => match[1]
			);

			expect(referenced.filter((name) => !commandNames.has(name))).toEqual([]);
		}
	);
});

describe('/taskgraph: references outside the plugin', () => {
	const commandNames = new Set(
		readdirSync(commandsDir)
			.filter((file) => file.endsWith('.md'))
			.map((file) => file.slice(0, -3))
	);

	it('all resolve to a plugin command', () => {
		const offenders = listTrackedFiles()
			.filter((file) => !ALLOWED_FILES.has(file))
			.flatMap((file) =>
				[
					...readFileSync(join(repoRoot, file), 'utf-8').matchAll(
						/\/taskgraph:([a-z][a-z-]*)/g
					)
				]
					.filter((match) => !commandNames.has(match[1]))
					.map((match) => `${file}: ${match[0]}`)
			);

		expect(offenders).toEqual([]);
	});
});
