/**
 * The legacy tasks.json writer can't be redirected through a symlink (#616)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeJSON } from '../../../../scripts/modules/utils.js';

describe('legacy writeJSON and symlinks', () => {
	let dir: string;
	let tasksPath: string;
	let outside: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-symlink-'));
		tasksPath = path.join(dir, 'tasks.json');
		outside = path.join(dir, 'outside.txt');
		fs.writeFileSync(outside, 'keep me');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('leaves a symlink planted at the old temp name alone', () => {
		const planted = `${tasksPath}.tmp.${process.pid}`;
		fs.symlinkSync(outside, planted);

		writeJSON(tasksPath, { master: { tasks: [] } });

		expect(fs.readFileSync(outside, 'utf8')).toBe('keep me');
		expect(fs.lstatSync(planted).isSymbolicLink()).toBe(true);
		expect(JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks).toEqual(
			[]
		);
	});

	it('refuses to write when tasks.json is a symlink', () => {
		fs.symlinkSync(outside, tasksPath);

		expect(() => writeJSON(tasksPath, { master: { tasks: [] } })).toThrow(
			/symlink/
		);
		expect(fs.readFileSync(outside, 'utf8')).toBe('keep me');
		expect(fs.lstatSync(tasksPath).isSymbolicLink()).toBe(true);
	});
});
