/**
 * Guard: a write into the project goes through writeProjectFile or
 * appendProjectFile (storage/adapters/file-storage/file-operations.ts),
 * which refuse a symlinked file or folder. Writers that placed those checks
 * by hand kept forgetting one (GHSA-62pv, #1072).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MODULES = join(dirname(fileURLToPath(import.meta.url)), 'modules');

const WRITE =
	/\b(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|createWriteStream|writeAtomically)\s*\(/;

/** Files that may write directly, each with why */
const ALLOWED: Record<string, string> = {
	'storage/adapters/file-storage/file-operations.ts':
		'the writer itself, and the locked tasks.json writer, which refuses links itself',
	'git/merge-driver/merge-driver-files.ts':
		"writeAtomically on git's own temp file for the merge (%A), outside the project tree",
	'init/shell-aliases.ts': "appends to the user's shell startup file in home",
	'loop/loop-trust.ts': 'the trust list in ~/.taskgraph, outside the project',
	'loop/parallel/task-worktrees.ts':
		"inside the git dir (info/exclude, branch records), where a checkout can't put a link",
	'loop/parallel/container-workers.ts':
		'a worker clone sanitizeClone checked for links (wx), and its state copy into a folder it just removed',
	'tasks/utils/todo-note.ts':
		"the plugin's private data folder (listDir), outside the project",
	'migration/upstream-import.ts':
		'copyNewFiles: COPYFILE_EXCL never writes through a link, and folders leading out are skipped'
};

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) return sourceFiles(path);
		return /\.ts$/.test(name) && !/\.(spec|test)\./.test(name) ? [path] : [];
	});
}

const writers = sourceFiles(MODULES)
	.map((file) => ({
		file: relative(MODULES, file).split(sep).join('/'),
		lines: readFileSync(file, 'utf8')
			.split('\n')
			.flatMap((line, i) => (WRITE.test(line) ? [i + 1] : []))
	}))
	.filter(({ lines }) => lines.length > 0);

describe('project file writes', () => {
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
