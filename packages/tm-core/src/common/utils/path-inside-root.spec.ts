/**
 * @fileoverview Tests for resolving a path to one spelling inside a root
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePathInsideRoot } from './path-inside-root.js';

describe('resolvePathInsideRoot', () => {
	let base: string;
	let root: string;
	let docker: string;

	beforeAll(() => {
		base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-root-')));
		root = path.join(base, 'project');
		docker = path.join(root, '.docker');
		fs.mkdirSync(docker, { recursive: true });
		fs.mkdirSync(path.join(root, 'src'));
		fs.symlinkSync('.docker', path.join(root, 'linked'));
		fs.symlinkSync(base, path.join(root, 'escape'));
	});

	afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

	it.each([
		'.docker',
		'.docker/',
		'.docker//',
		'.docker/./',
		'./.docker',
		'src/../.docker',
		'linked'
	])('resolves %s to the one absolute spelling', (candidate) => {
		expect(resolvePathInsideRoot(root, candidate)).toBe(docker);
	});

	it('resolves an absolute path inside the root', () => {
		expect(resolvePathInsideRoot(root, `${root}//.docker/.`)).toBe(docker);
	});

	it('resolves the root itself', () => {
		expect(resolvePathInsideRoot(root, '.')).toBe(root);
		expect(resolvePathInsideRoot(root, '')).toBe(root);
	});

	it('keeps the part that does not exist yet', () => {
		expect(resolvePathInsideRoot(root, 'linked//new/./file')).toBe(
			path.join(docker, 'new', 'file')
		);
	});

	it.each(['..', '../x', 'src/../../x', 'escape'])(
		'returns null for %s, which leaves the root',
		(candidate) => {
			expect(resolvePathInsideRoot(root, candidate)).toBeNull();
		}
	);

	it('returns null for home paths and non-strings', () => {
		expect(resolvePathInsideRoot(root, '~/.docker')).toBeNull();
		expect(resolvePathInsideRoot(root, undefined)).toBeNull();
		expect(resolvePathInsideRoot(root, 42)).toBeNull();
	});

	it('returns null for an absolute path above the root', () => {
		expect(resolvePathInsideRoot(root, base)).toBeNull();
	});

	it('does not treat a sibling sharing the prefix as inside', () => {
		expect(resolvePathInsideRoot(root, `${root}-other`)).toBeNull();
	});
});
