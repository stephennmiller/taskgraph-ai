/**
 * @fileoverview When `go` may start without asking (#1146): a stored
 * approval stands for a run that only resumes, never for one that plans new
 * tasks, which parse-prd would withdraw it for.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isGoTrusted, trustLoop } from './loop-trust.js';

describe('isGoTrusted', () => {
	let base: string;
	let home: string;
	let project: string;

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-')));
		home = path.join(base, 'home');
		project = path.join(base, 'project');
		fs.mkdirSync(home);
		fs.mkdirSync(project);
	});

	afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

	it('lets a stored approval stand for a run that plans nothing new', () => {
		trustLoop(project, home);

		expect(isGoTrusted(project, false, home)).toBe(true);
	});

	it('asks for a run that plans new tasks, even with an approval stored', () => {
		trustLoop(project, home);

		expect(isGoTrusted(project, true, home)).toBe(false);
	});

	it('asks where nothing is stored, whatever the run does', () => {
		expect(isGoTrusted(project, false, home)).toBe(false);
		expect(isGoTrusted(project, true, home)).toBe(false);
	});
});
