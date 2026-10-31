/**
 * @fileoverview What `parse-prd`, `expand --all`, `update-task`, `update`
 * and `update-subtask` print, run against the built CLI with the fake
 * `claude` program so no real AI call is made (#182).
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { installFakeClaude } from '../../fakes/install-fake-claude.mjs';
import {
	copyProject,
	getCliBinPath,
	RM_OPTS
} from '../../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

const BOX = /[╭╮╰╯│┌┐└┘]/;
const USAGE = /tokens \(/;

const task = (id: number, title: string, extra: object = {}) => ({
	id,
	title,
	description: `${title}, described`,
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: [],
	...extra
});

/** A task as the update schemas want it back from the model */
const modelTask = (id: number, title: string) => ({
	id,
	title,
	description: `${title}, described`,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	details: 'Details long enough to keep',
	testStrategy: null,
	subtasks: null
});

describe.skipIf(!built)('AI command output (fake claude)', () => {
	let project: string;
	let work: string;
	let env: NodeJS.ProcessEnv;

	const taskgraph = (...args: string[]) => {
		const res = spawnSync(process.execPath, [binPath, ...args], {
			cwd: project,
			encoding: 'utf8',
			timeout: 25000,
			env
		});
		return { ...res, all: `${res.stdout}${res.stderr}` };
	};

	const tasksFile = () =>
		path.join(project, '.taskgraph', 'tasks', 'tasks.json');
	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksFile(), 'utf8')).master.tasks;
	const writeTasks = (tasks: object[]) =>
		fs.writeFileSync(
			tasksFile(),
			JSON.stringify({
				master: {
					tasks,
					metadata: { created: '2026-01-01T00:00:00Z' }
				}
			})
		);

	/** (Re)install the fake; replies apply to the calls made after this */
	const install = (replies?: object[]) => {
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies
		});
		env = {
			...process.env,
			FORCE_COLOR: '0',
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			...fake.env
		};
	};

	const expectTidy = (output: string) => {
		expect(output).not.toMatch(BOX);
		for (const line of output.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	};

	// One initialized project, copied for each test: init alone takes seconds
	let template: string;

	beforeAll(() => {
		template = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-output-template-'));
		spawnSync('git', ['init', '-q'], { cwd: template });
		const init = spawnSync(process.execPath, [binPath, 'init', '--yes'], {
			cwd: template,
			encoding: 'utf8',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		expect(init.status).toBe(0);
	});

	afterAll(() => {
		fs.rmSync(template, RM_OPTS);
	});

	beforeEach(() => {
		project = copyProject(template, 'tm-ai-output-');
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ai-output-work-'));
		install();
	});

	afterEach(() => {
		fs.rmSync(project, RM_OPTS);
		fs.rmSync(work, RM_OPTS);
	});

	it('parse-prd ends with where the tasks went and one next step', () => {
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'docs', 'prd.md'),
			'# Todo\nA tiny todo tool with add, list and done commands.\n'
		);

		const res = taskgraph(
			'parse-prd',
			'.taskgraph/docs/prd.md',
			'--num-tasks=2',
			'--force'
		);

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			`Saved to ${path.join('.taskgraph', 'tasks', 'tasks.json')}`
		);
		expect(res.stdout).toContain('Next: taskgraph next');
		expect(res.stdout).not.toContain('Next steps');
		expectTidy(res.stdout);
	});

	it('expand --all lists each task once, then one summary and one usage line', () => {
		writeTasks([task(1, 'Parse commands'), task(2, 'Store todos')]);

		// The fake answers with one subtask, and a one-subtask reply to a
		// larger count is retried (#721)
		const res = taskgraph('expand', '--all', '--num=1');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('✓ Added 1 subtask to task 1');
		expect(res.stdout).toContain('✓ Added 1 subtask to task 2');
		expect(res.stdout).toContain('✓ Expanded 2 tasks');
		expect(res.stdout.match(new RegExp(USAGE, 'g'))).toHaveLength(1);
		expect(res.all).not.toMatch(
			/Expansion Summary|Expanding all pending|Multiple concurrent spinners|Successfully expanded/
		);
		expectTidy(res.stdout);
	});

	it('expand --all says why there is nothing to do', () => {
		writeTasks([
			task(1, 'Parse commands', {
				subtasks: [{ id: 1, title: 'One', status: 'pending', dependencies: [] }]
			})
		]);

		const res = taskgraph('expand', '--all');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'No pending tasks to expand: 1 already has subtasks'
		);
		expect(res.stdout).toContain('Add --force to replace their subtasks');
	});

	it('expand --all exits 1 when a task fails, and says which', () => {
		writeTasks([task(1, 'Parse commands')]);
		install([{ error: 'boom' }]);

		const res = taskgraph('expand', '--all', '--num=2');

		expect(res.status).toBe(1);
		expect(res.all).toContain("Couldn't expand task 1");
		expect(res.all).toContain("✗ Couldn't expand 1 task");
	});

	it('update-task confirms the task it rewrote in two lines', () => {
		writeTasks([task(1, 'Parse commands'), task(2, 'Store todos')]);
		install([{ object: { task: modelTask(2, 'Store todos in SQLite') } }]);

		const res = taskgraph('update-task', '--id=2', '--prompt=Use SQLite');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('✓ Updated task 2  Store todos in SQLite');
		expect(res.stdout).toContain('Run taskgraph show 2 to see what changed');
		expect(readTasks()[1].title).toBe('Store todos in SQLite');
		expectTidy(res.stdout);
	});

	it('update-task --append shows the notes once, without labels or markers', () => {
		writeTasks([task(1, 'Parse commands')]);
		install([{ text: 'Keep the alias table next to the command table.' }]);

		const res = taskgraph(
			'update-task',
			'--id=1',
			'--append',
			'--prompt=Note the aliases'
		);

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('✓ Added notes to task 1  Parse commands');
		expect(res.stdout).toContain(
			'  Keep the alias table next to the command table.'
		);
		expect(res.stdout).not.toMatch(/Successfully|Newly Added|<info added on/);
		expect(readTasks()[0].details).toContain('<info added on');
		expectTidy(res.stdout);
	});

	it('update-task on a done task fails with the fix', () => {
		writeTasks([task(1, 'Parse commands', { status: 'done' })]);

		const res = taskgraph('update-task', '--id=1', '--prompt=Anything');

		expect(res.status).toBe(1);
		expect(res.stderr).toContain("✗ Task 1 is done, so it can't be updated");
		expect(res.stderr).toContain('taskgraph set-status 1 pending');
		expect(res.all).not.toMatch(BOX);
	});

	it('update-subtask shows the notes it added', () => {
		writeTasks([
			task(1, 'Parse commands', {
				subtasks: [
					{
						id: 1,
						title: 'Define the command table',
						description: 'd',
						status: 'pending',
						dependencies: []
					}
				]
			})
		]);
		install([{ text: 'Map ls to list before routing.' }]);

		const res = taskgraph(
			'update-subtask',
			'--id=1.1',
			'--prompt=Aliases are needed'
		);

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'✓ Added notes to subtask 1.1  Define the command table'
		);
		expect(res.stdout).toContain('  Map ls to list before routing.');
		expectTidy(res.stdout);
	});

	it('update-subtask says once when the AI added nothing', () => {
		writeTasks([
			task(1, 'Parse commands', {
				subtasks: [
					{
						id: 1,
						title: 'Define the command table',
						description: 'd',
						status: 'pending',
						dependencies: []
					}
				]
			})
		]);
		install([{ text: '' }]);

		const res = taskgraph(
			'update-subtask',
			'--id=1.1',
			'--prompt=Aliases are needed'
		);

		expect(res.status).toBe(0);
		expect(res.all).toContain('Nothing added to subtask 1.1');
		expect(res.all).not.toMatch(/did not contain|empty or whitespace/);
	});

	it('update --from lists the tasks it changed instead of a wide table', () => {
		writeTasks([
			task(1, 'Parse commands'),
			task(2, 'Store todos'),
			task(3, 'Print the list')
		]);
		install([
			{
				object: {
					tasks: [
						modelTask(2, 'Store todos in a typed repository'),
						modelTask(3, 'Print typed Todo records')
					]
				}
			}
		]);

		const res = taskgraph('update', '--from=2', '--prompt=Use TypeScript');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain('✓ Updated 2 tasks');
		expect(res.stdout).toContain('  2  Store todos in a typed repository');
		expect(res.stdout).toContain('  3  Print typed Todo records');
		expect(res.stdout).not.toMatch(/updateTasks called|Successfully updated/);
		expectTidy(res.stdout);
	});

	it('update --from past the last unfinished task says so', () => {
		writeTasks([task(1, 'Parse commands')]);

		const res = taskgraph('update', '--from=9', '--prompt=Anything');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'No tasks to update: none from 9 on are unfinished'
		);
	});

	it.each([
		['update', '--from=1', '--prompt=Anything'],
		['update-task', '--id=1', '--prompt=Anything'],
		['expand', '--id=1', '--num=2']
	])('%s prints a failed AI call once (#272)', (...args) => {
		writeTasks([task(1, 'Parse commands')]);
		install([{ error: 'boom' }]);

		const res = taskgraph(...args);

		expect(res.status).toBe(1);
		const errorLines = res.all.split('\n').filter((l) => l.includes('boom'));
		expect(errorLines).toEqual([
			'✗ Claude Code API error during object generation: boom'
		]);
		expect(res.all).not.toMatch(/Attempt 1 failed|requestBodyValues/);
	});
});
