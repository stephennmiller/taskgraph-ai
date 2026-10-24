import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyTemplateFile } from './project-files.js';

describe('copyTemplateFile', () => {
	let dir: string;
	const problems: string[] = [];
	const report = (level: string, message: string) => {
		problems.push(`${level}: ${message}`);
	};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-template-'));
		problems.length = 0;
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('says a missing template was not found', () => {
		copyTemplateFile('no-such-template', path.join(dir, 'out'), report);

		expect(problems).toEqual([
			'error: Source file not found: no-such-template'
		]);
	});

	it('gives the real reason when a template exists but cannot be read', () => {
		// The assets folder itself: there, but reading it fails with EISDIR
		copyTemplateFile('.', path.join(dir, 'out'), report);

		expect(problems).toEqual([
			expect.stringMatching(/^error: Couldn't read the \. template: EISDIR/)
		]);
		expect(fs.existsSync(path.join(dir, 'out'))).toBe(false);
	});

	it('reports a file it cannot write instead of throwing', () => {
		// A link to a missing folder: not there, and writing through it fails
		const target = path.join(dir, '.env.example');
		fs.symlinkSync(path.join(dir, 'missing', 'x'), target);

		copyTemplateFile('env.example', target, report);

		expect(problems).toEqual([
			expect.stringMatching(/^error: Couldn't write \.env\.example: ENOENT/)
		]);
	});
});
