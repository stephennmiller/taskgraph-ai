/**
 * @fileoverview Integration test for when the built CLI prints the ASCII
 * banner. stdout is forced to look like a terminal (the banner never prints
 * into a pipe), so this checks what a user sees: routine commands start with
 * their result, and only bare `taskgraph`, the top-level help screen and a
 * first `init` carry the banner.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTask, createTasksFile } from '@tm/core/testing';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const stripAnsi = (text: string) =>
	text
		.replace(/\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
		.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');

const forceTty = pathToFileURL(
	path.resolve(__dirname, '../../fakes/force-tty.mjs')
).href;

// The banner's credit line, printed under the ASCII art
const BANNER_CREDIT = 'by x.com/stephennmiller_';
// The bottom row of the pre-rendered "TaskGraph" art
const BANNER_ART_ROW = '|_|\\__,_|___/_|\\_\\\\____|_|  \\__,_| .__/|_| |_|';

/** Run the built CLI in `cwd` with stdout looking like a terminal */
const runInTerminal = (
	cwd: string,
	args: string[],
	env: NodeJS.ProcessEnv = {}
): string =>
	stripAnsi(
		execFileSync(
			process.execPath,
			['--import', forceTty, getCliBinPath(), ...args],
			{
				cwd,
				encoding: 'utf-8',
				stdio: 'pipe',
				env: {
					...process.env,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1',
					TASKGRAPH_GO_STEP: '',
					TM_HIDE_BANNER: '',
					COLUMNS: '80',
					...env
				}
			}
		)
	);

describe('ASCII banner in a terminal', () => {
	let testDir: string;

	const run = (...args: string[]): string => runInTerminal(testDir, args);

	beforeAll(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-banner-test-'));
		execFileSync(process.execPath, [getCliBinPath(), 'init', '--yes'], {
			cwd: testDir,
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		const tasks = createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'Set up the database', status: 'done' }),
				createTask({
					id: 2,
					title: 'Build the login API',
					status: 'pending',
					dependencies: ['1']
				})
			]
		});
		fs.writeFileSync(
			path.join(testDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(tasks, null, 2)
		);
	});

	afterAll(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('shows the banner above the top-level help screen', () => {
		const output = run('--help');

		expect(output).toContain(BANNER_ART_ROW);
		expect(output).toContain(BANNER_CREDIT);
		expect(output).toContain('Daily workflow');
	});

	it('shows the banner above the help screen for bare taskgraph', () => {
		const output = run();

		expect(output).toContain(BANNER_CREDIT);
		expect(output).toContain('Daily workflow');
	});

	it.each(['list', 'show 2', 'next', 'tags', 'validate-dependencies'])(
		'starts `taskgraph %s` with its result, not the banner',
		(command) => {
			const output = run(...command.split(' '));

			expect(output).not.toContain(BANNER_CREDIT);
			expect(output.trim().length).toBeGreaterThan(0);
		}
	);

	it('puts the status change on the first line of set-status', () => {
		const output = run('set-status', '--id=2', '--status=in-progress');

		expect(output).not.toContain(BANNER_CREDIT);
		expect(output.split('\n')[0]).toBe('✓ Task 2  ○ pending → ▶ in-progress');
	});

	it('prints the help screen without the banner for bare --no-banner', () => {
		const output = run('--no-banner');

		expect(output).not.toContain(BANNER_CREDIT);
		expect(output).toContain('Daily workflow');
	});

	it('accepts --no-banner as a no-op on routine commands', () => {
		const output = run('--no-banner', 'tags');

		expect(output).not.toContain(BANNER_CREDIT);
		expect(output).toContain('master');
	});
});

describe('ASCII banner on init (#1147)', () => {
	let dir: string;

	const init = (env: NodeJS.ProcessEnv, ...args: string[]): string =>
		runInTerminal(dir, ['init', '--yes', ...args], env);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-banner-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('welcomes a first run, and starts a re-run with its result', () => {
		const first = init({}, '--no-git');
		const again = init({}, '--no-git');

		expect(first).toContain(BANNER_CREDIT);
		expect(first).toContain('Next: taskgraph go <prd>');
		expect(again.split('\n')[0]).toBe(
			`✓ TaskGraph is already set up in ${path.basename(dir)}`
		);
		expect(again).not.toContain('doctor');
	});

	it('leaves the banner out of a dry run', () => {
		expect(init({}, '--dry-run').split('\n')[0]).toBe(
			'Dry run; nothing was changed. Init would:'
		);
	});

	it('prints only the result and its rows as a step of taskgraph go', () => {
		const output = init({ TASKGRAPH_GO_STEP: '1' }, '--no-git');

		expect(output.split('\n')).toEqual([
			`✓ Set up TaskGraph in ${path.basename(dir)}`,
			'  .taskgraph/  tasks, settings and PRD templates',
			'  .gitignore   created',
			"  CLAUDE.md    loads TaskGraph's instructions in Claude Code",
			''
		]);
	});
});
