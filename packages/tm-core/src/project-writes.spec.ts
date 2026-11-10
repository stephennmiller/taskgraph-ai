/**
 * Guard: a write into the project goes through writeProjectFile or
 * appendProjectFile, and a new folder, delete or rename through
 * makeProjectDir, removeProjectFile or renameProjectFile
 * (storage/adapters/file-storage/file-operations.ts), which refuse a
 * symlinked file or folder. Writers that placed those checks by hand kept
 * forgetting one (GHSA-62pv, #1072). Covers tm-core, the CLI, the MCP
 * server and tm-profiles (#1123).
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** Every folder of shipped TypeScript that could write into a project */
const SCANNED = [
	'packages/tm-core/src/modules',
	'packages/tm-core/src/common',
	'packages/tm-profiles/src',
	...readdirSync(join(REPO, 'apps'))
		.map((app) => `apps/${app}/src`)
		.filter((dir) => existsSync(join(REPO, dir)))
];

const WRITE =
	/\b(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|createWriteStream|writeAtomically)\s*\(/;
/**
 * Renames, deletes and new folders (#1123), as node:fs spells them: called
 * bare or on `fs`, `fsSync`, `fs.promises`. Not `tags.rename(` or `git.rm(`.
 */
const FILE_OP =
	/(?<![\w.])(?:(?:fs\w*|promises)\.)*(rename|rm|unlink|rmdir|mkdir)(Sync)?\s*\(/;
const IMPORTS_FS = /from '(node:)?fs(\/promises)?'/;

/** Files that may write directly, each with why */
const ALLOWED: Record<string, string> = {
	'packages/tm-core/src/common/utils/write-atomically.ts':
		'the temp-file-and-rename helper the writer itself uses',
	'packages/tm-core/src/modules/storage/adapters/file-storage/file-operations.ts':
		'the writer itself, and the locked tasks.json writer, which refuses links itself',
	'packages/tm-core/src/modules/git/merge-driver/merge-driver-files.ts':
		'writeAtomically on the temp file git just created for the merge (%A, .merge_file_* in the root); the rename replaces it, never follows it',
	'packages/tm-core/src/modules/init/shell-aliases.ts':
		"appends to the user's shell startup file in home",
	'packages/tm-core/src/modules/loop/loop-trust.ts':
		'the trust list in ~/.taskgraph, outside the project',
	'packages/tm-core/src/modules/loop/parallel/task-worktrees.ts':
		"inside the git dir (info/exclude, branch records), where a checkout can't put a link, and the worktrees folder prepareWorktreesDir checked to be real",
	'packages/tm-core/src/modules/loop/parallel/container-workers.ts':
		'a worker clone sanitizeClone checked for links (wx), and its state copy into a folder it just removed; rmSync removes a link, never follows it',
	'packages/tm-core/src/modules/tasks/utils/todo-note.ts':
		"the plugin's private data folder (listDir), outside the project",
	'packages/tm-core/src/modules/migration/upstream-import.ts':
		'copyNewFiles: COPYFILE_EXCL never writes through a link, and folders leading out are skipped',
	'packages/tm-core/src/modules/config/services/runtime-state-manager.service.ts':
		'clearState unlinks state.json for ConfigDomain.reset, which no command calls',
	'packages/tm-profiles/src/legacy-commands.ts':
		'pruneLegacySlashCommands skips a linked folder on the way to .claude/commands/tm, and removes entries without following them',
	'apps/cli/src/completion/install.ts':
		"the completion script and the shell startup file in the user's home",
	'apps/cli/src/utils/auto-update/check-update.ts':
		"the update check's cache file in ~/.taskgraph",
	'apps/cli/src/utils/auto-update/install.ts':
		"the installer's lock file in ~/.taskgraph"
};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.ts$/.test(name) && !/\.(spec|test)\./.test(name) ? [path] : [];
	});
}

/** Line numbers in `source` that write, rename, delete or make a folder directly */
function directWrites(source: string): number[] {
	const fsCalls = IMPORTS_FS.test(source);
	return source
		.split('\n')
		.flatMap((line, i) =>
			WRITE.test(line) || (fsCalls && FILE_OP.test(line)) ? [i + 1] : []
		);
}

const writers = SCANNED.flatMap((dir) => sourceFiles(join(REPO, dir)))
	.map((file) => ({
		file: relative(REPO, file).split(sep).join('/'),
		lines: directWrites(readFileSync(file, 'utf8'))
	}))
	.filter(({ lines }) => lines.length > 0);

describe('project file writes', () => {
	it('sees fs calls and not methods that share a name (guards the patterns)', () => {
		const fs = "import fs from 'node:fs';\n";

		expect(directWrites(`${fs}fs.renameSync(a, b);`)).toEqual([2]);
		expect(directWrites(`${fs}await fs.promises.rm(file);`)).toEqual([2]);
		expect(directWrites(`${fs}await fsp.mkdir(dir);`)).toEqual([2]);
		expect(
			directWrites("import { unlink } from 'node:fs/promises';\nunlink(a);")
		).toEqual([2]);
		expect(directWrites(`${fs}await tmCore.tags.rename(a, b);`)).toEqual([]);
		expect(directWrites('await unlink(issue);')).toEqual([]);
		expect(SCANNED).toEqual(
			expect.arrayContaining(['apps/cli/src', 'apps/mcp/src'])
		);
	});

	it('go through writeProjectFile outside the allowed files', () => {
		const offenders = writers
			.filter(({ file }) => !(file in ALLOWED))
			.flatMap(({ file, lines }) => lines.map((line) => `${file}:${line}`));

		expect(offenders).toEqual([]);
	});

	it('allow only files that still write directly', () => {
		const writing = new Set(writers.map(({ file }) => file));

		expect(Object.keys(ALLOWED).filter((file) => !writing.has(file))).toEqual(
			[]
		);
	});
});
