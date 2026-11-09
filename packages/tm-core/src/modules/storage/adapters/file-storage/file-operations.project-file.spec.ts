import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendProjectFile, writeProjectFile } from './file-operations.js';

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
