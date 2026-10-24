import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeAtomically } from './write-atomically.js';

describe('writeAtomically', () => {
	let dir: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'write-atomically-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
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
