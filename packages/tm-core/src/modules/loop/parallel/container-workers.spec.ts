import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkerStatus, sanitizeClone } from './container-workers.js';

describe('sanitizeClone', () => {
	let dir: string;
	let clone: string;
	let gitDir: string;
	let outside: string;

	beforeEach(() => {
		dir = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sanitize-'))
		);
		clone = path.join(dir, 'clone');
		gitDir = path.join(clone, '.git');
		outside = path.join(dir, 'outside');
		for (const d of [
			'objects/info',
			'refs/heads',
			'hooks',
			'info',
			'modules/sub'
		]) {
			fs.mkdirSync(path.join(gitDir, d), { recursive: true });
		}
		fs.mkdirSync(outside);
		fs.writeFileSync(path.join(outside, 'keep.txt'), 'host file');
		fs.writeFileSync(
			path.join(gitDir, 'config'),
			'[core]\n\tfsmonitor = evil\n'
		);
		fs.writeFileSync(path.join(gitDir, 'hooks', 'pre-commit'), 'evil');
		fs.writeFileSync(path.join(gitDir, 'info', 'attributes'), '* filter=x');
		fs.writeFileSync(path.join(gitDir, 'modules', 'sub', 'config'), 'evil');
		fs.writeFileSync(path.join(gitDir, 'config.worktree'), 'evil');
		fs.writeFileSync(path.join(gitDir, 'commondir'), '/elsewhere');
		fs.writeFileSync(
			path.join(gitDir, 'objects', 'info', 'alternates'),
			outside
		);
		fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('removes config, hooks, attributes, modules and pointers elsewhere, and writes a fresh config', () => {
		sanitizeClone(clone, '[core]\n');

		expect(fs.readFileSync(path.join(gitDir, 'config'), 'utf8')).toBe(
			'[core]\n'
		);
		for (const gone of [
			'hooks',
			'info',
			'modules',
			'config.worktree',
			'commondir',
			'objects/info'
		]) {
			expect(fs.existsSync(path.join(gitDir, gone))).toBe(false);
		}
		expect(fs.existsSync(path.join(gitDir, 'HEAD'))).toBe(true);
	});

	it('removes a symlink in place of a folder without touching where it points', () => {
		fs.rmSync(path.join(gitDir, 'hooks'), { recursive: true });
		fs.symlinkSync(outside, path.join(gitDir, 'hooks'));
		fs.rmSync(path.join(gitDir, 'config'));
		fs.symlinkSync(path.join(outside, 'keep.txt'), path.join(gitDir, 'config'));

		sanitizeClone(clone, '[core]\n');

		expect(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8')).toBe(
			'host file'
		);
		expect(fs.lstatSync(path.join(gitDir, 'config')).isSymbolicLink()).toBe(
			false
		);
		expect(fs.existsSync(path.join(gitDir, 'hooks'))).toBe(false);
	});

	it('refuses when .git or its objects are a symlink', () => {
		fs.rmSync(path.join(gitDir, 'objects'), { recursive: true });
		fs.symlinkSync(outside, path.join(gitDir, 'objects'));

		expect(() => sanitizeClone(clone, '[core]\n')).toThrow(
			"isn't a plain folder"
		);
		expect(fs.readdirSync(outside)).toEqual(['keep.txt']);

		fs.rmSync(gitDir, { recursive: true });
		fs.symlinkSync(outside, gitDir);
		expect(() => sanitizeClone(clone, '[core]\n')).toThrow(
			"isn't a plain folder"
		);
	});

	it('refuses a symlinked packed-refs before any fetch, naming it', () => {
		fs.writeFileSync(path.join(outside, 'packed-refs'), 'x');
		fs.symlinkSync(
			path.join(outside, 'packed-refs'),
			path.join(gitDir, 'packed-refs')
		);

		expect(() => sanitizeClone(clone, '[core]\n')).toThrow(
			".git/packed-refs isn't a plain file or folder"
		);
	});

	it('refuses a symlink deep in objects, such as objects/pack', () => {
		fs.symlinkSync(outside, path.join(gitDir, 'objects', 'pack'));

		expect(() => sanitizeClone(clone, '[core]\n')).toThrow(
			".git/objects/pack isn't a plain file or folder"
		);
	});

	it('refuses a socket or FIFO, which could hang the fetch', async () => {
		const server = net.createServer();
		await new Promise<void>((resolve) =>
			server.listen(path.join(gitDir, 'packed-refs'), resolve)
		);
		try {
			expect(() => sanitizeClone(clone, '[core]\n')).toThrow(
				".git/packed-refs isn't a plain file or folder"
			);
		} finally {
			server.close();
		}
	});

	it('refuses a .git bigger than the cap', () => {
		fs.writeFileSync(path.join(gitDir, 'objects', 'big'), Buffer.alloc(2048));

		expect(() => sanitizeClone(clone, '[core]\n', 1024)).toThrow(
			'too big to fetch from'
		);
	});
});

describe('readWorkerStatus', () => {
	let dir: string;
	let stateDir: string;
	let tasksFile: string;
	const write = (status: unknown) =>
		fs.writeFileSync(
			tasksFile,
			JSON.stringify({ master: { tasks: [{ id: '3', status }] } })
		);

	beforeEach(() => {
		dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-status-')));
		stateDir = path.join(dir, 'task-3.state');
		tasksFile = path.join(stateDir, '.taskgraph', 'tasks', 'tasks.json');
		fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('reads a known status', () => {
		write('review');
		expect(readWorkerStatus(stateDir, '3', 'master')).toBe('review');
	});

	it('ignores a bad status and a missing file', () => {
		write('shipped');
		expect(readWorkerStatus(stateDir, '3', 'master')).toBeUndefined();
		fs.rmSync(tasksFile);
		expect(readWorkerStatus(stateDir, '3', 'master')).toBeUndefined();
	});

	it('ignores a tasks.json that is a symlink out of the folder', () => {
		const outside = path.join(dir, 'outside.json');
		fs.writeFileSync(
			outside,
			JSON.stringify({ master: { tasks: [{ id: '3', status: 'done' }] } })
		);
		fs.symlinkSync(outside, tasksFile);

		expect(readWorkerStatus(stateDir, '3', 'master')).toBeUndefined();
	});

	it('ignores a file that is too big to be a task list', () => {
		fs.writeFileSync(tasksFile, '');
		fs.truncateSync(tasksFile, 33 * 1024 * 1024);

		expect(readWorkerStatus(stateDir, '3', 'master')).toBeUndefined();
	});
});
