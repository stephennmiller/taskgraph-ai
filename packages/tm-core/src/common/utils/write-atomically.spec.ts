import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeAtomically } from './write-atomically.js';

// Fixed random part, so a test can plant something at the temp file's name
vi.mock('node:crypto', async (importOriginal) => ({
	...(await importOriginal<typeof import('node:crypto')>()),
	randomBytes: () => Buffer.from('a1b2c3d4e5f6', 'hex')
}));
const tempOf = (file: string) =>
	`${file}.taskgraph-${process.pid}-a1b2c3d4e5f6.tmp`;

describe('writeAtomically', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-atomically-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('replaces the file and leaves no temp file', () => {
		const file = path.join(dir, 'out');
		fs.writeFileSync(file, 'old');

		writeAtomically(file, 'new');

		expect(fs.readFileSync(file, 'utf8')).toBe('new');
		expect(fs.readdirSync(dir)).toEqual(['out']);
	});

	it('refuses a symlink planted at the temp name and leaves everything as it was', () => {
		const file = path.join(dir, 'out');
		const elsewhere = path.join(dir, 'elsewhere');
		fs.writeFileSync(file, 'old');
		fs.writeFileSync(elsewhere, 'not yours');
		fs.symlinkSync(elsewhere, tempOf(file));

		expect(() => writeAtomically(file, 'new')).toThrow(/EEXIST/);
		expect(fs.readFileSync(file, 'utf8')).toBe('old');
		expect(fs.readFileSync(elsewhere, 'utf8')).toBe('not yours');
		expect(fs.lstatSync(tempOf(file)).isSymbolicLink()).toBe(true);
	});

	it('removes its temp file when the rename fails', () => {
		// A non-empty folder at the target makes the rename fail
		const file = path.join(dir, 'out');
		fs.mkdirSync(file);
		fs.writeFileSync(path.join(file, 'keep'), 'x');

		expect(() => writeAtomically(file, 'new')).toThrow();
		expect(fs.readdirSync(dir)).toEqual(['out']);
	});
});
