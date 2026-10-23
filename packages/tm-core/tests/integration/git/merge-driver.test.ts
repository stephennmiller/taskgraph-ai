/**
 * @fileoverview The tasks.json merge driver's file side: reading git's three
 * temporary files and writing `%A`, and setting the driver up in a real
 * repository.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	MERGE_DRIVER_ATTRIBUTE,
	NotAGitRepositoryError,
	installMergeDriver,
	isOnPath,
	mergeDriverCommand,
	runTasksMergeDriver
} from '../../../src/modules/git/merge-driver/index.js';

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

const tag = (tasks: unknown[]) => ({ master: { tasks, metadata: {} } });
const task = (id: number, title: string, extra = {}) => ({
	id,
	title,
	status: 'pending',
	dependencies: [],
	subtasks: [],
	...extra
});

describe('runTasksMergeDriver', () => {
	let dir: string;
	const at = (name: string) => path.join(dir, name);
	const write = (name: string, content: unknown) =>
		fs.writeFileSync(
			at(name),
			typeof content === 'string' ? content : `${JSON.stringify(content)}\n`
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-merge-driver-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	const files = () => ({
		basePath: at('base'),
		oursPath: at('ours'),
		theirsPath: at('theirs')
	});

	it('writes the merged JSON to the current side and reports renumbering', () => {
		write('base', tag([task(1, 'A')]));
		write('ours', tag([task(1, 'A'), task(2, 'Ours')]));
		write('theirs', tag([task(1, 'A'), task(2, 'Theirs')]));

		const outcome = runTasksMergeDriver(files());

		expect(outcome).toEqual({
			status: 'merged',
			renumbered: [{ tag: 'master', from: '2', to: '3' }],
			conflicts: []
		});
		const written = fs.readFileSync(at('ours'), 'utf8');
		expect(written.endsWith('}\n')).toBe(true);
		expect(
			JSON.parse(written).master.tasks.map((t: { id: number }) => t.id)
		).toEqual([1, 2, 3]);
	});

	it('treats an empty ancestor as a file both branches added', () => {
		write('base', '');
		write('ours', tag([task(1, 'Ours')]));
		write('theirs', tag([task(1, 'Theirs')]));

		const outcome = runTasksMergeDriver(files());

		expect(outcome.status).toBe('merged');
		expect(
			JSON.parse(fs.readFileSync(at('ours'), 'utf8')).master.tasks
		).toHaveLength(2);
	});

	it('writes valid JSON and reports a conflict when a field changed both ways', () => {
		write('base', tag([task(1, 'A')]));
		write('ours', tag([task(1, 'A', { status: 'done' })]));
		write('theirs', tag([task(1, 'A', { status: 'review' })]));

		const outcome = runTasksMergeDriver(files());

		expect(outcome.status).toBe('conflicted');
		const written = JSON.parse(fs.readFileSync(at('ours'), 'utf8'));
		expect(written.master.tasks[0].status).toBe('done');
	});

	it("leaves the current side untouched when a side isn't valid JSON", () => {
		const ours = `${JSON.stringify(tag([task(1, 'A')]))}\n`;
		write('base', tag([task(1, 'A')]));
		write('ours', ours);
		write('theirs', '{ "master": <<<<<<< broken');

		const outcome = runTasksMergeDriver(files());

		expect(outcome).toMatchObject({ status: 'unreadable', side: 'theirs' });
		expect(fs.readFileSync(at('ours'), 'utf8')).toBe(ours);
		expect(fs.readdirSync(dir).sort()).toEqual(['base', 'ours', 'theirs']);
	});
});

describe('installMergeDriver', () => {
	let repo: string;

	beforeEach(() => {
		repo = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-merge-driver-repo-'))
		);
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	it('adds the attribute and config once, keeping existing attributes', () => {
		git(repo, 'init', '--initial-branch=main');
		fs.writeFileSync(path.join(repo, '.gitattributes'), '*.png binary');

		const first = installMergeDriver(
			repo,
			'taskgraph merge-driver %O %A %B %P'
		);
		const again = installMergeDriver(
			repo,
			'taskgraph merge-driver %O %A %B %P'
		);

		expect(first).toEqual({ attributes: 'updated', config: 'set' });
		expect(again).toEqual({ attributes: 'unchanged', config: 'unchanged' });
		expect(fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8')).toBe(
			`*.png binary\n${MERGE_DRIVER_ATTRIBUTE}\n`
		);
		expect(git(repo, 'config', '--get', 'merge.taskgraph.driver')).toBe(
			'taskgraph merge-driver %O %A %B %P'
		);
		expect(
			git(repo, 'check-attr', 'merge', '.taskgraph/tasks/tasks.json')
		).toBe('.taskgraph/tasks/tasks.json: merge: taskgraph');
	});

	it('updates the config when the command changed', () => {
		git(repo, 'init', '--initial-branch=main');
		installMergeDriver(repo, 'old');

		expect(installMergeDriver(repo, 'new')).toEqual({
			attributes: 'unchanged',
			config: 'set'
		});
		expect(git(repo, 'config', '--get', 'merge.taskgraph.driver')).toBe('new');
	});

	it('refuses outside a Git repository and writes nothing', () => {
		expect(() => installMergeDriver(repo, 'x')).toThrow(NotAGitRepositoryError);
		expect(fs.existsSync(path.join(repo, '.gitattributes'))).toBe(false);
	});
});

describe('mergeDriverCommand', () => {
	it('runs taskgraph by name when it is on PATH', () => {
		expect(
			mergeDriverCommand({ onPath: true, execPath: '/n', scriptPath: '/s' })
		).toBe('taskgraph merge-driver %O %A %B %P');
	});

	it('runs this CLI by its quoted path otherwise', () => {
		expect(
			mergeDriverCommand({
				onPath: false,
				execPath: '/opt/node 22/bin/node',
				scriptPath: '/a/"x"/taskgraph.js'
			})
		).toBe(
			'"/opt/node 22/bin/node" "/a/\\"x\\"/taskgraph.js" merge-driver %O %A %B %P'
		);
	});
});

describe('isOnPath', () => {
	it('finds an executable in a PATH directory and nothing elsewhere', () => {
		const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-path-'));
		const file = path.join(bin, 'tool');
		fs.writeFileSync(file, '#!/bin/sh\n');
		fs.chmodSync(file, 0o755);
		try {
			expect(isOnPath('tool', bin, [''])).toBe(true);
			expect(isOnPath('missing', bin, [''])).toBe(false);
		} finally {
			fs.rmSync(bin, { recursive: true, force: true });
		}
	});
});
