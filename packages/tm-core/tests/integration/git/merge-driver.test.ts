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
	MERGE_DRIVER_ATTRIBUTES,
	MERGE_DRIVER_FALLBACK,
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

	it('reads archive.json so an incoming task never takes an archived ID', () => {
		write('base', tag([task(1, 'A')]));
		write('ours', tag([task(1, 'A')]));
		write('theirs', tag([task(1, 'A'), task(2, 'Theirs')]));
		write('archive.json', {
			master: { tasks: [task(2, 'Archived')], metadata: { highestId: 2 } }
		});

		const outcome = runTasksMergeDriver({
			...files(),
			path: at('tasks.json')
		});

		expect(outcome).toMatchObject({
			status: 'merged',
			renumbered: [{ tag: 'master', from: '2', to: '3' }]
		});
	});

	it("merges without the archive when it can't be read", () => {
		write('base', tag([task(1, 'A')]));
		write('ours', tag([task(1, 'A')]));
		write('theirs', tag([task(1, 'A'), task(2, 'Theirs')]));
		write('archive.json', '<<<<<<< HEAD\n{}\n=======\n');

		const outcome = runTasksMergeDriver({
			...files(),
			path: at('tasks.json')
		});

		expect(outcome).toMatchObject({ status: 'merged', renumbered: [] });
	});

	it('merges archive.json as an archive, checking the tasks.json beside it', () => {
		const archived = (id: number, title: string) => ({
			...task(id, title, { status: 'done' }),
			archivedAt: '2026-02-01T00:00:00.000Z'
		});
		const archive = (tasks: unknown[], highestId: number) => ({
			master: { tasks, metadata: { highestId } }
		});
		write('base', archive([], 0));
		write('ours', archive([archived(1, 'A')], 1));
		write('theirs', archive([archived(2, 'Theirs')], 2));
		// This branch reused 2 for a live task
		write('tasks.json', tag([task(2, 'Ours')]));

		const outcome = runTasksMergeDriver({
			...files(),
			path: at('archive.json')
		});

		expect(outcome).toMatchObject({
			status: 'conflicted',
			renumbered: [],
			conflicts: [{ id: '2', kind: 'archived-theirs' }]
		});
		expect(JSON.parse(fs.readFileSync(at('ours'), 'utf8'))).toEqual(
			archive([archived(1, 'A'), archived(2, 'Theirs')], 2)
		);
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

	it.each([
		['an array', '[]'],
		['null', 'null'],
		['a string', '"tasks"']
	])(
		'treats %s at the top of a side as unreadable, not as no tasks',
		(_, text) => {
			const theirs = `${JSON.stringify(tag([task(1, 'A')]))}\n`;
			write('base', tag([task(1, 'A')]));
			write('ours', text);
			write('theirs', theirs);

			const outcome = runTasksMergeDriver(files());

			expect(outcome).toMatchObject({ status: 'unreadable', side: 'ours' });
			expect(fs.readFileSync(at('ours'), 'utf8')).toBe(text);
		}
	);

	it('leaves the current side untouched when the temporary file is taken', () => {
		const ours = `${JSON.stringify(tag([task(1, 'A'), task(2, 'Ours')]))}\n`;
		write('base', tag([task(1, 'A')]));
		write('ours', ours);
		write('theirs', tag([task(1, 'A'), task(2, 'Theirs')]));
		const taken = path.join(dir, 'elsewhere');
		write('elsewhere', 'not yours');
		fs.symlinkSync(taken, `${at('ours')}.taskgraph-merge-${process.pid}`);

		expect(() => runTasksMergeDriver(files())).toThrow(/EEXIST/);
		expect(fs.readFileSync(at('ours'), 'utf8')).toBe(ours);
		expect(fs.readFileSync(taken, 'utf8')).toBe('not yours');
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
			`*.png binary\n${MERGE_DRIVER_ATTRIBUTES.join('\n')}\n`
		);
		expect(git(repo, 'config', '--get', 'merge.taskgraph.driver')).toBe(
			'taskgraph merge-driver %O %A %B %P'
		);
		expect(
			git(repo, 'check-attr', 'merge', '.taskgraph/tasks/tasks.json')
		).toBe('.taskgraph/tasks/tasks.json: merge: taskgraph');
		// A name of its own, so a CLI from before archive.json had a driver
		// (configured only for `taskgraph`) text-merges it instead
		expect(
			git(repo, 'check-attr', 'merge', '.taskgraph/tasks/archive.json')
		).toBe('.taskgraph/tasks/archive.json: merge: taskgraph-archive');
		expect(git(repo, 'config', '--get', 'merge.taskgraph-archive.driver')).toBe(
			'taskgraph merge-driver %O %A %B %P'
		);
	});

	it('adds the archive.json line to a project set up before it had one', () => {
		git(repo, 'init', '--initial-branch=main');
		const attributes = `${MERGE_DRIVER_ATTRIBUTES[0]}\n`;
		fs.writeFileSync(path.join(repo, '.gitattributes'), attributes);

		expect(installMergeDriver(repo, 'x').attributes).toBe('updated');
		expect(fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8')).toBe(
			`${MERGE_DRIVER_ATTRIBUTES.join('\n')}\n`
		);
	});

	it('updates the config when the command it wrote changed', () => {
		git(repo, 'init', '--initial-branch=main');
		const command = (scriptPath: string) =>
			mergeDriverCommand({ onPath: false, execPath: '/node', scriptPath });
		installMergeDriver(repo, command('/old/cli.js'));

		expect(installMergeDriver(repo, command('/new/cli.js'))).toEqual({
			attributes: 'unchanged',
			config: 'set'
		});
		expect(git(repo, 'config', '--get', 'merge.taskgraph.driver')).toBe(
			command('/new/cli.js')
		);
	});

	it("keeps a merge.taskgraph driver and name it didn't write", () => {
		git(repo, 'init', '--initial-branch=main');
		git(repo, 'config', 'merge.taskgraph.driver', 'my-merge %O %A %B');
		git(repo, 'config', 'merge.taskgraph.name', 'Mine');

		const result = installMergeDriver(
			repo,
			mergeDriverCommand({ onPath: true, execPath: '/n', scriptPath: '/s' })
		);

		expect(result).toEqual({ attributes: 'created', config: 'kept' });
		expect(git(repo, 'config', '--get', 'merge.taskgraph.driver')).toBe(
			'my-merge %O %A %B'
		);
		expect(git(repo, 'config', '--get', 'merge.taskgraph.name')).toBe('Mine');
	});

	it('keeps a merge attribute tasks.json already has', () => {
		git(repo, 'init', '--initial-branch=main');
		const attributes = '/.taskgraph/tasks/tasks.json merge=union\n';
		fs.writeFileSync(path.join(repo, '.gitattributes'), attributes);

		const result = installMergeDriver(repo, 'taskgraph merge-driver');

		expect(result).toEqual({ attributes: 'kept', config: 'set' });
		expect(fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8')).toBe(
			`${attributes}${MERGE_DRIVER_ATTRIBUTES[1]}\n`
		);
	});

	it('counts its own lines among other attributes as already there', () => {
		git(repo, 'init', '--initial-branch=main');
		const attributes = MERGE_DRIVER_ATTRIBUTES.map(
			(line) => `${line} -diff\n`
		).join('');
		fs.writeFileSync(path.join(repo, '.gitattributes'), attributes);

		expect(installMergeDriver(repo, 'x').attributes).toBe('unchanged');
		expect(fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8')).toBe(
			attributes
		);
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
		).toBe(
			`if command -v taskgraph >/dev/null 2>&1; then taskgraph merge-driver %O %A %B %P; else ${MERGE_DRIVER_FALLBACK}; fi`
		);
	});

	it('runs this CLI by its quoted path otherwise', () => {
		expect(
			mergeDriverCommand({
				onPath: false,
				execPath: '/opt/node 22/bin/node',
				scriptPath: '/a/"x"/taskgraph.js'
			})
		).toBe(
			'if [ -x "/opt/node 22/bin/node" ] && [ -f "/a/\\"x\\"/taskgraph.js" ]; ' +
				'then "/opt/node 22/bin/node" "/a/\\"x\\"/taskgraph.js" merge-driver %O %A %B %P; ' +
				`else ${MERGE_DRIVER_FALLBACK}; fi`
		);
	});
});

describe('the driver command through a real git merge', () => {
	let root: string;

	beforeEach(() => {
		root = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-merge-driver-quote-'))
		);
	});

	afterEach(() => {
		fs.rmSync(root, { recursive: true, force: true });
	});

	// Each one is special to sh or to git's %-placeholders
	it.each([
		'with space',
		"single'quote",
		'double"quote',
		'dollar$HOME',
		'back`id`tick',
		'per%Acent',
		'back\\slash'
	])("runs a CLI in a folder named %s with git's arguments intact", (name) => {
		const cliDir = path.join(root, name);
		fs.mkdirSync(cliDir);
		const argsFile = path.join(root, 'args.json');
		// A stand-in CLI: records its arguments and writes a merged %A
		const script = path.join(cliDir, 'cli.cjs');
		fs.writeFileSync(
			script,
			`const fs = require('fs');
fs.writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));
fs.writeFileSync(process.argv[4], '{"merged":true}\\n');`
		);
		const repo = path.join(root, 'repo');
		fs.mkdirSync(repo);
		git(repo, 'init', '-q', '--initial-branch=main');
		git(repo, 'config', 'user.email', 'test@example.com');
		git(repo, 'config', 'user.name', 'Test');
		installMergeDriver(
			repo,
			mergeDriverCommand({
				onPath: false,
				execPath: process.execPath,
				scriptPath: script
			})
		);
		const tasksFile = path.join(repo, '.taskgraph/tasks/tasks.json');
		fs.mkdirSync(path.dirname(tasksFile), { recursive: true });
		const commit = (content: string) => {
			fs.writeFileSync(tasksFile, content);
			git(repo, 'commit', '-q', '-am', content);
		};
		fs.writeFileSync(tasksFile, '{"a":1}\n');
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', 'base');
		git(repo, 'checkout', '-q', '-b', 'feature');
		commit('{"a":2}\n');
		git(repo, 'checkout', '-q', 'main');
		commit('{"a":3}\n');

		git(repo, 'merge', '--no-edit', 'feature');

		const args = JSON.parse(fs.readFileSync(argsFile, 'utf8'));
		expect(args[0]).toBe('merge-driver');
		expect(args[4]).toBe('.taskgraph/tasks/tasks.json');
		expect(fs.readFileSync(tasksFile, 'utf8')).toBe('{"merged":true}\n');
	});
});

describe('merge driver when the CLI is gone', () => {
	let repo: string;
	const tasksFile = '.taskgraph/tasks/tasks.json';
	const writeTasks = (tasks: unknown[]) => {
		fs.mkdirSync(path.join(repo, '.taskgraph/tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(repo, tasksFile),
			`${JSON.stringify(tag(tasks), null, 2)}\n`
		);
	};
	const commit = (message: string) => {
		git(repo, 'add', '-A');
		git(repo, 'commit', '-q', '-m', message);
	};

	beforeEach(() => {
		repo = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-merge-driver-gone-'))
		);
		git(repo, 'init', '-q', '--initial-branch=main');
		git(repo, 'config', 'user.email', 'test@example.com');
		git(repo, 'config', 'user.name', 'Test');
	});

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	// A PATH with git but no taskgraph, for the by-name command
	const pathWithoutTaskgraph = (process.env.PATH ?? '')
		.split(path.delimiter)
		.filter((dir) => dir && !fs.existsSync(path.join(dir, 'taskgraph')))
		.join(path.delimiter);

	it.each([
		['by name, not on PATH', true],
		['by a path that no longer exists', false]
	])('falls back to a normal text conflict when run %s', (_, onPath) => {
		installMergeDriver(
			repo,
			mergeDriverCommand({
				onPath,
				execPath: process.execPath,
				scriptPath: path.join(repo, 'no-such-cli.js')
			})
		);
		writeTasks([task(1, 'A')]);
		commit('base');
		git(repo, 'checkout', '-q', '-b', 'feature');
		writeTasks([task(1, 'A'), task(2, 'Theirs')]);
		commit('feature adds 2');
		git(repo, 'checkout', '-q', 'main');
		writeTasks([task(1, 'A'), task(2, 'Ours')]);
		commit('main adds 2');

		expect(() =>
			execFileSync('git', ['merge', '--no-edit', 'feature'], {
				cwd: repo,
				stdio: 'pipe',
				env: { ...process.env, PATH: pathWithoutTaskgraph }
			})
		).toThrow();

		const content = fs.readFileSync(path.join(repo, tasksFile), 'utf8');
		expect(content).toContain('<<<<<<< ours');
		expect(content).toContain('>>>>>>> theirs');
		expect(content).toContain('"Ours"');
		expect(content).toContain('"Theirs"');
		expect(git(repo, 'diff', '--name-only', '--diff-filter=U')).toBe(tasksFile);
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
