import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLoopTrusted, trustLoop, untrustLoop } from './loop-trust.js';

describe('loop trust', () => {
	let base: string;
	let home: string;
	let project: string;

	beforeEach(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-trust-')));
		home = path.join(base, 'home');
		project = path.join(base, 'project');
		fs.mkdirSync(home);
		fs.mkdirSync(project);
	});

	afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

	it('does not trust a project nobody approved', () => {
		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('trusts a project after trustLoop, and only that project', () => {
		trustLoop(project, home);

		expect(isLoopTrusted(project, home)).toBe(true);
		expect(isLoopTrusted(path.join(base, 'other'), home)).toBe(false);
	});

	it('ignores a trust file planted inside the project', () => {
		fs.mkdirSync(path.join(project, '.taskgraph'));
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'loop-trusted.json'),
			JSON.stringify([project])
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('treats a corrupt trust file as nobody trusted', () => {
		fs.mkdirSync(path.join(home, '.taskgraph'));
		fs.writeFileSync(
			path.join(home, '.taskgraph', 'loop-trusted.json'),
			'{nope'
		);

		expect(isLoopTrusted(project, home)).toBe(false);
	});

	it('keeps earlier approvals when another project is trusted', () => {
		const other = path.join(base, 'other');
		fs.mkdirSync(other);
		trustLoop(project, home);
		trustLoop(other, home);

		expect(isLoopTrusted(project, home)).toBe(true);
		expect(isLoopTrusted(other, home)).toBe(true);
	});

	it('forgets one project on untrustLoop and keeps the others', () => {
		const other = path.join(base, 'other');
		fs.mkdirSync(other);
		trustLoop(project, home);
		trustLoop(other, home);

		untrustLoop(project, home);

		expect(isLoopTrusted(project, home)).toBe(false);
		expect(isLoopTrusted(other, home)).toBe(true);
	});

	it('writes no trust file when untrusting a project nobody approved', () => {
		untrustLoop(project, home);

		expect(fs.existsSync(path.join(home, '.taskgraph'))).toBe(false);
	});
});
