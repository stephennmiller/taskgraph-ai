/**
 * @fileoverview The tasks.json merge driver end to end: `taskgraph init` on
 * the built CLI sets it up in a Git repository, then a real `git merge` of
 * two branches that both added tasks runs it.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Subtask, Task } from '@tm/core';
import { createSubtask, createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const TASKS_FILE = '.taskgraph/tasks/tasks.json';
const ARCHIVE_FILE = '.taskgraph/tasks/archive.json';

/**
 * PATH without any `taskgraph` executable, so init points git at this
 * build by its path instead of a globally installed CLI
 */
const pathWithoutTaskgraph = (process.env.PATH ?? '')
	.split(path.delimiter)
	.filter((dir) => dir && !fs.existsSync(path.join(dir, 'taskgraph')))
	.join(path.delimiter);

describe('merge driver with git merge', () => {
	let repo: string;
	const binPath = getCliBinPath();
	const env = {
		...process.env,
		PATH: pathWithoutTaskgraph,
		TASKGRAPH_SKIP_AUTO_UPDATE: '1',
		FORCE_COLOR: '0',
		GIT_AUTHOR_NAME: 'Test',
		GIT_AUTHOR_EMAIL: 'test@example.com',
		GIT_COMMITTER_NAME: 'Test',
		GIT_COMMITTER_EMAIL: 'test@example.com'
	};

	const git = (...args: string[]) =>
		spawnSync('git', args, { cwd: repo, encoding: 'utf8', env });
	const gitOk = (...args: string[]) => {
		const result = git(...args);
		expect(result.status, result.stderr).toBe(0);
		return result.stdout.trim();
	};
	const cli = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: repo,
			encoding: 'utf8',
			timeout: 30000,
			env
		});

	const writeTasks = (tasks: Task[]) =>
		fs.writeFileSync(
			path.join(repo, TASKS_FILE),
			`${JSON.stringify(
				createTasksFile({
					tasks,
					metadata: { lastModified: '2026-01-01T00:00:00.000Z' }
				}),
				null,
				2
			)}\n`
		);
	const readTasks = (): Task[] =>
		JSON.parse(fs.readFileSync(path.join(repo, TASKS_FILE), 'utf8')).master
			.tasks;
	const writeArchive = (tasks: Task[], highestId: number) =>
		fs.writeFileSync(
			path.join(repo, ARCHIVE_FILE),
			`${JSON.stringify(
				{
					master: {
						tasks: tasks.map((t) => ({
							...t,
							archivedAt: '2026-02-01T00:00:00.000Z'
						})),
						metadata: { highestId }
					}
				},
				null,
				2
			)}\n`
		);
	const readArchive = (): Task[] =>
		JSON.parse(fs.readFileSync(path.join(repo, ARCHIVE_FILE), 'utf8')).master
			.tasks;
	const commitAll = (message: string) => {
		gitOk('add', '-A');
		gitOk('commit', '-q', '-m', message);
	};

	const sub = (id: number, title: string, parentId: string, extra = {}) =>
		createSubtask({ id, title, parentId, ...extra }) as Subtask;

	/** Base: task 1 with subtask 1.1; returns to main afterwards */
	const branchFromBase = (
		ours: Task[],
		theirs: Task[]
	): { stdout: string; stderr: string; status: number | null } => {
		writeTasks([
			createTask({ id: 1, title: 'Set up', subtasks: [sub(1, 'Repo', '1')] })
		]);
		commitAll('base');
		gitOk('checkout', '-q', '-b', 'feature');
		writeTasks(theirs);
		commitAll('feature');
		gitOk('checkout', '-q', 'main');
		writeTasks(ours);
		commitAll('main');
		const merge = git('merge', '--no-edit', 'feature');
		return {
			stdout: merge.stdout,
			stderr: merge.stderr,
			status: merge.status
		};
	};

	beforeEach(() => {
		repo = fs.realpathSync(
			fs.mkdtempSync(path.join(os.tmpdir(), 'tm-merge-driver-cli-'))
		);
		gitOk('init', '-q', '--initial-branch=main');
		const init = cli('init', '--yes', '--no-aliases');
		expect(init.status, init.stderr).toBe(0);
		// Starting the built CLI for init can take over 15s on a busy machine
	}, 60000);

	afterEach(() => {
		fs.rmSync(repo, { recursive: true, force: true });
	});

	it('init routes tasks.json and archive.json to the driver and turns it on for this clone', () => {
		expect(fs.readFileSync(path.join(repo, '.gitattributes'), 'utf8')).toBe(
			`${TASKS_FILE} merge=taskgraph\n${ARCHIVE_FILE} merge=taskgraph\n`
		);
		expect(gitOk('check-attr', 'merge', TASKS_FILE)).toBe(
			`${TASKS_FILE}: merge: taskgraph`
		);
		const driver = gitOk('config', '--get', 'merge.taskgraph.driver');
		expect(driver).toContain(`"${binPath}" merge-driver %O %A %B %P`);
		expect(driver).toContain('else git merge-file');
	});

	it('keeps both new tasks and renumbers the incoming ones, dependencies and subtasks included', () => {
		const result = branchFromBase(
			[
				createTask({
					id: 1,
					title: 'Set up',
					subtasks: [sub(1, 'Repo', '1'), sub(2, 'Ours: CI', '1')]
				}),
				createTask({ id: 2, title: 'Ours: login' })
			],
			[
				createTask({
					id: 1,
					title: 'Set up',
					subtasks: [
						sub(1, 'Repo', '1'),
						sub(2, 'Theirs: lint', '1', { dependencies: [1] })
					]
				}),
				createTask({
					id: 2,
					title: 'Theirs: search',
					subtasks: [
						sub(1, 'Index', '2'),
						sub(2, 'Query', '2', { dependencies: [1] })
					]
				}),
				createTask({ id: 3, title: 'Theirs: ranking', dependencies: ['2'] })
			]
		);

		expect(result.status, result.stderr).toBe(0);
		// Only colliding IDs move: incoming 3 is free here, so it keeps its ID
		expect(result.stdout).toContain(
			'✓ Merged tasks.json; renumbered incoming 2 → 4, 1.2 → 1.3'
		);

		const tasks = readTasks();
		const byId = new Map(tasks.map((t) => [String(t.id), t]));
		expect(tasks.map((t) => [String(t.id), t.title]).sort()).toEqual([
			['1', 'Set up'],
			['2', 'Ours: login'],
			['3', 'Theirs: ranking'],
			['4', 'Theirs: search']
		]);
		expect(byId.get('3')?.dependencies.map(String)).toEqual(['4']);
		expect(
			byId.get('4')?.subtasks.map((s) => [String(s.id), String(s.parentId)])
		).toEqual([
			['1', '4'],
			['2', '4']
		]);
		expect(byId.get('1')?.subtasks.map((s) => [String(s.id), s.title])).toEqual(
			[
				['1', 'Repo'],
				['2', 'Ours: CI'],
				['3', 'Theirs: lint']
			]
		);
		expect(byId.get('1')?.subtasks[2].dependencies.map(String)).toEqual(['1']);
		expect(gitOk('status', '--porcelain')).toBe('');
	});

	it('marks the file conflicted, keeps valid JSON and lists the clash', () => {
		const result = branchFromBase(
			[
				createTask({
					id: 1,
					title: 'Set up',
					status: 'done',
					subtasks: [sub(1, 'Repo', '1')]
				}),
				createTask({ id: 2, title: 'Ours: login' })
			],
			[
				createTask({
					id: 1,
					title: 'Set up',
					status: 'review',
					subtasks: [sub(1, 'Repo', '1')]
				}),
				createTask({ id: 2, title: 'Theirs: search' })
			]
		);

		expect(result.status).not.toBe(0);
		const output = result.stdout + result.stderr;
		expect(output).toContain(
			"1 change to tasks.json clashes; kept this branch's value"
		);
		expect(output).toMatch(/1\s+status\s+done · incoming: review/);
		expect(output).toContain('Renumbered incoming 2 → 3');
		expect(output).toContain(`Edit ${TASKS_FILE} to choose, then git add it`);
		expect(gitOk('diff', '--name-only', '--diff-filter=U')).toBe(TASKS_FILE);

		const tasks = readTasks();
		expect(tasks[0].status).toBe('done');
		expect(tasks.map((t) => t.title)).toEqual([
			'Set up',
			'Ours: login',
			'Theirs: search'
		]);
	});

	describe('when a branch archives', () => {
		const done = (id: number, title: string) =>
			createTask({ id, title, status: 'done' });

		/** Base: tasks 1 to 3 done, nothing archived; returns to main */
		const archiveOnBothBranches = (
			ours: { tasks: Task[]; archived: Task[]; highestId: number },
			theirs: { tasks: Task[]; archived: Task[]; highestId: number }
		) => {
			writeTasks([done(1, 'One'), done(2, 'Two'), done(3, 'Three')]);
			writeArchive([], 0);
			commitAll('base');
			gitOk('checkout', '-q', '-b', 'feature');
			writeTasks(theirs.tasks);
			writeArchive(theirs.archived, theirs.highestId);
			commitAll('feature');
			gitOk('checkout', '-q', 'main');
			writeTasks(ours.tasks);
			writeArchive(ours.archived, ours.highestId);
			commitAll('main');
			return git('merge', '--no-edit', 'feature');
		};

		it('merges archive.json as data when both branches archived', () => {
			const merge = archiveOnBothBranches(
				{
					tasks: [done(2, 'Two'), done(3, 'Three')],
					archived: [done(1, 'One')],
					highestId: 1
				},
				{
					tasks: [done(1, 'One'), done(2, 'Two')],
					archived: [done(3, 'Three')],
					highestId: 3
				}
			);

			expect(merge.status, merge.stdout + merge.stderr).toBe(0);
			expect(readArchive().map((t) => t.title)).toEqual(['One', 'Three']);
			expect(
				JSON.parse(fs.readFileSync(path.join(repo, ARCHIVE_FILE), 'utf8'))
					.master.metadata.highestId
			).toBe(3);
			expect(readTasks().map((t) => t.title)).toEqual(['Two']);
		});

		it('reports an ID the incoming branch archived and this branch reused', () => {
			// Feature added 4 and archived it; main archived 1 and added its own 4
			const merge = archiveOnBothBranches(
				{
					tasks: [
						done(2, 'Two'),
						done(3, 'Three'),
						createTask({ id: 4, title: 'Ours' })
					],
					archived: [done(1, 'One')],
					highestId: 1
				},
				{
					tasks: [done(1, 'One'), done(2, 'Two'), done(3, 'Three')],
					archived: [done(4, 'Theirs')],
					highestId: 4
				}
			);

			expect(merge.status).not.toBe(0);
			const output = merge.stdout + merge.stderr;
			expect(output).toContain(
				"1 change to archive.json clashes; kept this branch's value"
			);
			expect(output).toMatch(
				/4\s+archived on the incoming branch; this branch has another task 4/
			);
			expect(output).toContain(
				'Run taskgraph move --from=4 --to=<free ID>, then git add both files'
			);
			expect(gitOk('diff', '--name-only', '--diff-filter=U')).toBe(
				ARCHIVE_FILE
			);
			expect(readArchive().map((t) => t.title)).toEqual(['One', 'Theirs']);
		});
	});

	it('a clone without the config falls back to a normal text conflict', () => {
		// A fresh clone: .gitattributes came with it, the config didn't
		gitOk('config', '--remove-section', 'merge.taskgraph');

		const result = branchFromBase(
			[
				createTask({ id: 1, title: 'Set up' }),
				createTask({ id: 2, title: 'Ours' })
			],
			[
				createTask({ id: 1, title: 'Set up' }),
				createTask({ id: 2, title: 'Theirs' })
			]
		);

		expect(result.status).not.toBe(0);
		expect(result.stdout).toContain('CONFLICT (content)');
		expect(fs.readFileSync(path.join(repo, TASKS_FILE), 'utf8')).toContain(
			'<<<<<<<'
		);
	});

	it('init --merge-driver sets the driver up in a clone that lacks it', () => {
		// A fresh clone: .gitattributes came with it, the config didn't
		gitOk('config', '--remove-section', 'merge.taskgraph');

		const result = cli('init', '--merge-driver');

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain('✓ Git now merges tasks.json by task');
		expect(gitOk('config', '--get', 'merge.taskgraph.driver')).toContain(
			'merge-driver %O %A %B %P'
		);
		expect(cli('init', '--merge-driver').stdout.trim()).toBe(
			'The tasks.json merge driver is already set up'
		);
	});
});
