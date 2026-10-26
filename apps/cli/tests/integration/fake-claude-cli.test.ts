/**
 * @fileoverview Runs AI commands through the built CLI against the fake
 * `claude` program, so no real AI call is made.
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeClaude, readTrace } from '../fakes/install-fake-claude.mjs';
import { getCliBinPath, RM_OPTS } from '../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

describe.skipIf(!built)('built CLI against the fake claude', () => {
	let project: string;
	let work: string;
	let cliEnv: NodeJS.ProcessEnv;
	let fakeDir: string;

	const taskgraph = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: project,
			encoding: 'utf8',
			timeout: 25000,
			env: cliEnv
		});

	const readTasks = () => {
		const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');
		if (!fs.existsSync(file)) return [];
		return JSON.parse(fs.readFileSync(file, 'utf8')).master?.tasks ?? [];
	};

	const install = (replies?: object[]) => {
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies
		});
		fakeDir = fake.dir;
		cliEnv = {
			...process.env,
			TASKGRAPH_SKIP_AUTO_UPDATE: '1',
			...fake.env
		};
	};

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-cli-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-claude-work-'));
		spawnSync('git', ['init', '-q'], { cwd: project });
		const init = spawnSync(process.execPath, [binPath, 'init', '--yes'], {
			cwd: project,
			encoding: 'utf8',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		expect(init.status).toBe(0);
	});

	afterEach(() => {
		fs.rmSync(project, RM_OPTS);
		fs.rmSync(work, RM_OPTS);
	});

	it('add-task writes a task built from the schema the CLI sent', () => {
		install();

		const res = taskgraph('add-task', '--prompt', 'Write a hello world');

		expect(res.status).toBe(0);
		const tasks = readTasks();
		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toMatch(/^Sample title/);
		const trace = readTrace(fakeDir);
		expect(trace).toHaveLength(1);
		expect(trace[0].prompt).toContain('Write a hello world');
		expect(Object.keys(trace[0].schema.properties.task.properties)).toEqual(
			expect.arrayContaining(['title', 'description', 'details'])
		);
	});

	it('add-task uses a canned reply when one is given', () => {
		install([
			{
				object: {
					task: {
						title: 'Canned title',
						description: 'Canned description of the work',
						details: 'Canned details that are long enough to pass',
						testStrategy: 'Canned test strategy',
						dependencies: []
					}
				}
			}
		]);

		const res = taskgraph('add-task', '--prompt', 'Anything');

		expect(res.status).toBe(0);
		expect(readTasks()[0].title).toBe('Canned title');
	});

	it('expand adds subtasks to a task', () => {
		install();
		expect(taskgraph('add-task', '--prompt', 'First task').status).toBe(0);

		const res = taskgraph('expand', '--id=1', '--num=1', '--force');

		expect(res.status).toBe(0);
		const [task] = readTasks();
		expect(task.subtasks.length).toBeGreaterThan(0);
		for (const subtask of task.subtasks) {
			expect(subtask.dependencies).not.toContain(subtask.id);
		}
		expect(readTrace(fakeDir)).toHaveLength(2);
	});

	it('scope-up prints only the result line, without a complexity report', () => {
		install();
		expect(taskgraph('add-task', '--prompt', 'First task').status).toBe(0);
		expect(taskgraph('expand', '--id=1', '--num=1', '--force').status).toBe(0);

		const res = taskgraph('scope-up', '--id=1');

		expect(res.status).toBe(0);
		const output = res.stdout + res.stderr;
		expect(output).toContain('✓ Scoped up 1 task');
		expect(output).not.toContain('No complexity report');
		expect(output).not.toContain('Regenerated');
		expect(output).not.toContain('Scoping up');
	});

	it('never reaches a real model: every command goes through the fake', () => {
		install();

		taskgraph('add-task', '--prompt', 'One');
		expect(readTrace(fakeDir)).toHaveLength(1);
		taskgraph('add-task', '--prompt', 'Two');
		expect(readTrace(fakeDir)).toHaveLength(2);
	});

	it('retries a call that fails with a temporary error', () => {
		install([{ error: 'overloaded' }]);

		const res = taskgraph('add-task', '--prompt', 'Survives one failure');

		expect(res.status).toBe(0);
		expect(readTasks()).toHaveLength(1);
		expect(readTrace(fakeDir)).toHaveLength(2);
	});

	it('fails with the error text and no task when a call fails for good', () => {
		install([{ error: 'boom' }]);

		const res = taskgraph('add-task', '--prompt', 'Nothing works');

		expect(res.status).not.toBe(0);
		expect(res.stdout + res.stderr).toContain('boom');
		expect(readTasks()).toEqual([]);
		// All three roles use the same model, so a failed one is not tried again
		expect(readTrace(fakeDir)).toHaveLength(1);
	});

	it('caps a main-role call at 6 turns and gives it the project summary', () => {
		install();
		fs.writeFileSync(path.join(project, 'server.js'), '');
		spawnSync('git', ['add', 'server.js'], { cwd: project });

		const res = taskgraph('add-task', '--prompt', 'Add a health check');

		expect(res.status, res.stderr).toBe(0);
		const [call] = readTrace(fakeDir);
		const turns = call.args.indexOf('--max-turns');
		expect(call.args[turns + 1]).toBe('6');
		expect(call.prompt).toContain('## Project summary');
		expect(call.prompt).toContain('server.js');
	});

	it('points at claudeCode.maxTurns when a call runs out of turns', () => {
		install([{ error: 'Reached maximum number of turns (6)' }]);

		const res = taskgraph('add-task', '--prompt', 'Too much to read');

		expect(res.status).not.toBe(0);
		expect(res.stderr).toContain('Reached maximum number of turns (6)');
		expect(res.stderr).toContain('Raise claudeCode.maxTurns');
	});

	it('parse-prd writes tasks with valid statuses', () => {
		install();
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'docs', 'prd.txt'),
			'# Product\nA tiny todo tool with add, list and done commands.\n'
		);

		const res = taskgraph(
			'parse-prd',
			'.taskgraph/docs/prd.txt',
			'--num-tasks=2',
			'--force'
		);

		expect(res.status).toBe(0);
		const tasks = readTasks();
		expect(tasks.length).toBeGreaterThan(0);
		for (const task of tasks) expect(task.status).toBe('pending');
	});

	it('parse-prd prints a failed call once, with its reason (#388)', () => {
		// The reason is model/CLI text: an escape in it must not reach the terminal
		install([{ error: 'boom\u001b]0;pwned\u0007' }]);
		fs.writeFileSync(path.join(project, 'prd.md'), '# Product\nA todo tool.\n');

		const res = taskgraph('parse-prd', 'prd.md', '--force');

		expect(res.status).toBe(1);
		const output = res.stdout + res.stderr;
		expect(res.stderr).toContain("✗ Couldn't generate tasks: boom");
		expect(res.stderr).not.toContain('\u001b]0;');
		expect(output.match(/Couldn't generate tasks/g)).toHaveLength(1);
		expect(output).not.toContain('Error parsing PRD');
		expect(readTasks()).toEqual([]);
	});

	it('research asks for plain text and prints the answer', () => {
		install();

		const res = taskgraph('research', 'what is a hash map');

		expect(res.status).toBe(0);
		expect(res.stdout + res.stderr).toContain('Sample text answer');
		expect(readTrace(fakeDir)[0].schema).toBeNull();
	});
});
