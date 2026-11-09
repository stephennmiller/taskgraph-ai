import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	appendProjectFile,
	makeProjectDir,
	removeProjectFile,
	renameProjectFile,
	writeProjectFile
} from './file-operations.js';

describe.skipIf(process.platform === 'win32')('writeProjectFile', () => {
	let root: string;
	let elsewhere: string;

	beforeEach(() => {
		root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tm-project-'));
		elsewhere = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tm-elsewhere-'));
	});

	afterEach(() => {
		fsSync.rmSync(root, { recursive: true, force: true });
		fsSync.rmSync(elsewhere, { recursive: true, force: true });
	});

	it('creates the folders and writes the file', () => {
		writeProjectFile(root, 'a/b/c.txt', 'hi');

		expect(fsSync.readFileSync(path.join(root, 'a/b/c.txt'), 'utf8')).toBe(
			'hi'
		);
	});

	it.each(['a', 'a/b'])(
		'refuses a symlinked folder at %s and writes nothing',
		(linked) => {
			fsSync.mkdirSync(path.join(root, path.dirname(linked)), {
				recursive: true
			});
			fsSync.symlinkSync(elsewhere, path.join(root, linked));

			expect(() => writeProjectFile(root, 'a/b/c.txt', 'hi')).toThrow(
				/symlink/
			);
			expect(fsSync.readdirSync(elsewhere)).toEqual([]);
		}
	);

	it('refuses a symlinked file, even with atomic', () => {
		const target = path.join(elsewhere, 'x');
		fsSync.writeFileSync(target, 'keep');
		fsSync.symlinkSync(target, path.join(root, 'f'));

		expect(() => writeProjectFile(root, 'f', 'hi')).toThrow(/symlink/);
		// atomic renames over the link instead of following it
		writeProjectFile(root, 'f', 'hi', { atomic: true });

		expect(fsSync.readFileSync(target, 'utf8')).toBe('keep');
		expect(fsSync.lstatSync(path.join(root, 'f')).isFile()).toBe(true);
	});

	it('with linkInProject, writes through a link inside the project only', () => {
		fsSync.writeFileSync(path.join(root, 'AGENTS.md'), 'old');
		fsSync.symlinkSync('AGENTS.md', path.join(root, 'CLAUDE.md'));
		fsSync.writeFileSync(path.join(elsewhere, 'x'), 'keep');
		fsSync.symlinkSync(path.join(elsewhere, 'x'), path.join(root, '.mcp.json'));

		writeProjectFile(root, 'CLAUDE.md', 'new', { linkInProject: true });

		expect(fsSync.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')).toBe(
			'new'
		);
		expect(() =>
			writeProjectFile(root, '.mcp.json', 'new', { linkInProject: true })
		).toThrow(/symlink/);
		expect(fsSync.readFileSync(path.join(elsewhere, 'x'), 'utf8')).toBe('keep');
	});

	it("with linkInProject, refuses a link into the project's .git", () => {
		fsSync.mkdirSync(path.join(root, '.git'));
		fsSync.writeFileSync(path.join(root, '.git', 'config'), 'keep');
		fsSync.symlinkSync('.git/config', path.join(root, 'CLAUDE.md'));

		expect(() =>
			writeProjectFile(root, 'CLAUDE.md', 'new', { linkInProject: true })
		).toThrow(/symlink/);
		expect(fsSync.readFileSync(path.join(root, '.git', 'config'), 'utf8')).toBe(
			'keep'
		);
	});

	it('checks only the file for a path outside the project', () => {
		const linkedDir = path.join(root, 'linked');
		fsSync.symlinkSync(elsewhere, linkedDir);

		writeProjectFile(
			path.join(root, 'project'),
			path.join(linkedDir, 'f'),
			'hi'
		);

		expect(fsSync.readFileSync(path.join(elsewhere, 'f'), 'utf8')).toBe('hi');
	});

	it('appendProjectFile refuses a symlinked file', async () => {
		const target = path.join(elsewhere, 'x');
		fsSync.writeFileSync(target, 'keep');
		fsSync.symlinkSync(target, path.join(root, 'f'));

		await expect(appendProjectFile(root, 'f', 'more')).rejects.toThrow(
			/symlink/
		);
		expect(fsSync.readFileSync(target, 'utf8')).toBe('keep');
	});
});

describe.skipIf(process.platform === 'win32')(
	'makeProjectDir, removeProjectFile and renameProjectFile (#1123)',
	() => {
		let root: string;
		let elsewhere: string;

		beforeEach(() => {
			root = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tm-project-'));
			elsewhere = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tm-elsewhere-'));
			fsSync.writeFileSync(path.join(elsewhere, 'x'), 'keep');
		});

		afterEach(() => {
			fsSync.rmSync(root, { recursive: true, force: true });
			fsSync.rmSync(elsewhere, { recursive: true, force: true });
		});

		it('make a folder, rename a file and delete it', () => {
			makeProjectDir(root, 'a/b');
			fsSync.writeFileSync(path.join(root, 'a/b/x'), 'mine');

			renameProjectFile(root, 'a/b/x', path.join(root, 'a/y'));
			removeProjectFile(root, 'a/b/x');

			expect(fsSync.readdirSync(path.join(root, 'a'))).toEqual(['b', 'y']);
			removeProjectFile(root, 'a/y');
			expect(fsSync.readdirSync(path.join(root, 'a'))).toEqual(['b']);
		});

		it('refuse a symlinked folder and leave what it points to alone', () => {
			fsSync.symlinkSync(elsewhere, path.join(root, 'a'));
			fsSync.writeFileSync(path.join(root, 'mine'), 'mine');

			expect(() => makeProjectDir(root, 'a/b')).toThrow(/symlink/);
			expect(() => makeProjectDir(root, 'a')).toThrow(/symlink/);
			expect(() => removeProjectFile(root, 'a/x')).toThrow(/symlink/);
			expect(() => renameProjectFile(root, 'a/x', 'x')).toThrow(/symlink/);
			expect(() => renameProjectFile(root, 'mine', 'a/mine')).toThrow(
				/symlink/
			);
			expect(fsSync.readdirSync(elsewhere)).toEqual(['x']);
			expect(fsSync.readdirSync(root).sort()).toEqual(['a', 'mine']);
		});

		it('delete a symlinked file itself, not the file it points to', () => {
			fsSync.symlinkSync(path.join(elsewhere, 'x'), path.join(root, 'link'));

			removeProjectFile(root, 'link');

			expect(fsSync.readdirSync(root)).toEqual([]);
			expect(fsSync.readFileSync(path.join(elsewhere, 'x'), 'utf8')).toBe(
				'keep'
			);
		});
	}
);
