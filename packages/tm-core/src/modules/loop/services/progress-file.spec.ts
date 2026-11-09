import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoopConfig } from '../types.js';
import { appendIterationLine, initProgressFile } from './progress-file.js';

describe.skipIf(process.platform === 'win32')('progress file', () => {
	let root: string;
	let elsewhere: string;
	let progressFile: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-progress-'));
		elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-elsewhere-'));
		progressFile = path.join(root, '.taskgraph', 'progress.txt');
		fs.mkdirSync(path.dirname(progressFile));
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
		fs.rmSync(elsewhere, { recursive: true, force: true });
	});

	it('is not appended through a committed symlink', async () => {
		const target = path.join(elsewhere, '.bashrc');
		fs.writeFileSync(target, 'keep\n');
		fs.symlinkSync(target, progressFile);
		const config = { progressFile, prompt: 'default', iterations: 1 };

		await expect(initProgressFile(root, config as LoopConfig)).rejects.toThrow(
			/symlink/
		);
		await expect(
			appendIterationLine(root, progressFile, {
				iteration: 1,
				status: 'success'
			})
		).rejects.toThrow(/symlink/);
		expect(fs.readFileSync(target, 'utf8')).toBe('keep\n');
	});

	it('is not appended through a symlinked .taskgraph folder', async () => {
		fs.rmSync(path.dirname(progressFile), { recursive: true });
		fs.symlinkSync(elsewhere, path.dirname(progressFile));
		const config = { progressFile, prompt: 'default', iterations: 1 };

		await expect(initProgressFile(root, config as LoopConfig)).rejects.toThrow(
			/symlink/
		);
		expect(fs.readdirSync(elsewhere)).toEqual([]);
	});
});
