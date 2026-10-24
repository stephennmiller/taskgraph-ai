/**
 * @fileoverview Which files research may send the model, and the file and
 * tree context it builds, on a real temporary project
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	gatherFileContext,
	gatherProjectTree,
	resolveContextFile
} from './project-context.js';

let base: string;
let root: string;

beforeEach(() => {
	base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-')));
	root = path.join(base, 'project');
	fs.mkdirSync(path.join(root, 'src'), { recursive: true });
	fs.writeFileSync(path.join(root, 'src', 'a.js'), 'a');
	fs.writeFileSync(path.join(base, 'outside.txt'), 'secret');
});

afterEach(() => {
	fs.rmSync(base, { recursive: true, force: true });
});

describe('resolveContextFile', () => {
	it('accepts files inside the project, relative or absolute', () => {
		const file = path.join(root, 'src', 'a.js');
		expect(resolveContextFile(root, 'src/a.js')).toBe(file);
		expect(resolveContextFile(root, './src//a.js')).toBe(file);
		expect(resolveContextFile(root, file)).toBe(file);
	});

	it.each([
		'../outside.txt',
		'src/../../outside.txt',
		'~/.ssh/id_rsa',
		'/etc/passwd'
	])('refuses %s, outside the project', (file) => {
		expect(() => resolveContextFile(root, file)).toThrow('outside the project');
	});

	it('refuses a path given absolute outside the project', () => {
		expect(() =>
			resolveContextFile(root, path.join(base, 'outside.txt'))
		).toThrow('outside the project');
	});

	it.each([
		'.env',
		'.ENV.local',
		'config/.env.production',
		'.git/config',
		'keys/server.pem',
		'id_rsa',
		'.aws/credentials',
		'kind-kubeconfig',
		'.env::$DATA'
	])('refuses the secret file %s, even when it exists', (file) => {
		fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
		try {
			fs.writeFileSync(path.join(root, file), 'TOKEN=1');
		} catch {
			// Some spellings can't be created here; refused either way
		}
		expect(() => resolveContextFile(root, file)).toThrow('secret file');
	});

	it('allows an example env file', () => {
		fs.writeFileSync(path.join(root, '.env.example'), 'TOKEN=');
		expect(resolveContextFile(root, '.env.example')).toBe(
			path.join(root, '.env.example')
		);
	});

	it('refuses a link that leads out of the project', () => {
		fs.symlinkSync(path.join(base, 'outside.txt'), path.join(root, 'link.txt'));
		expect(() => resolveContextFile(root, 'link.txt')).toThrow();
	});

	it('refuses a file that does not exist', () => {
		expect(() => resolveContextFile(root, 'src/nope.js')).toThrow(
			'File not found: src/nope.js'
		);
	});
});

describe('gatherFileContext', () => {
	it('formats files as the legacy research context did', () => {
		const { context, breakdown } = gatherFileContext(
			root,
			[path.join(root, 'src', 'a.js')],
			vi.fn()
		);
		const item = '**File: src/a.js** (0KB)\n\n```\na\n```';
		expect(context).toBe(`## File Context\n\n${item}`);
		expect(breakdown).toEqual([
			{
				path: 'src/a.js',
				sizeKB: 0,
				tokens: Math.ceil(item.length / 4),
				characters: item.length
			}
		]);
	});

	it('leaves out a directory and a file over 50 KB, with a warning', () => {
		fs.writeFileSync(path.join(root, 'big.txt'), 'x'.repeat(51 * 1024));
		const warn = vi.fn();

		const { context } = gatherFileContext(
			root,
			[path.join(root, 'src'), path.join(root, 'big.txt')],
			warn
		);

		expect(context).toBe('');
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("src isn't a file")
		);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('big.txt is over 50 KB')
		);
	});
});

describe('gatherProjectTree', () => {
	it('lists the project without .git, node_modules or .env', () => {
		fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
		fs.mkdirSync(path.join(root, '.git'));
		fs.writeFileSync(path.join(root, '.env'), 'TOKEN=1');

		const { context, breakdown } = gatherProjectTree(root);

		expect(context).toContain('project/ (0 files, 1 dirs)');
		expect(context).toContain('└── src/ (1 files, 0 dirs)');
		expect(context).toContain('a.js');
		expect(context).not.toMatch(/node_modules|\.git|\.env/);
		expect(breakdown).toMatchObject({ fileCount: 0, dirCount: 1 });
	});
});
