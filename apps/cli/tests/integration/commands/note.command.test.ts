/**
 * @fileoverview `taskgraph note` on the built CLI: the note is saved as
 * written with one result line, from an argument or stdin, and bad input
 * exits 1 with a fix and no write.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSubtask, createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

interface SavedTask {
	id: number | string;
	details?: string;
	subtasks?: Array<{ id: number; details?: string }>;
}

describe('note', () => {
	let testDir: string;
	let tasksPath: string;
	const binPath = getCliBinPath();

	const run = (args: string[], input?: string) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: testDir,
			encoding: 'utf8',
			timeout: 30000,
			input,
			env: {
				...process.env,
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				FORCE_COLOR: '0',
				COLUMNS: '80'
			}
		});

	const readTasks = (): SavedTask[] =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-note-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		expect(init.status).toBe(0);
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({
							id: 1,
							title: 'Build the login API',
							details: 'Use JWT',
							subtasks: [createSubtask({ id: 1, title: 'Hash passwords' })]
						})
					]
				})
			)
		);
		// Starting the built CLI for init can take over 15s on a busy machine
	}, 60000);

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('saves the note as written and prints one line', () => {
		const result = run(['note', '1', 'Chose argon2: already a dependency']);

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe(
			'✓ Added a note to task 1  Build the login API\n'
		);
		expect(readTasks()[0].details).toMatch(
			/^Use JWT\n<info added on (.+)>\nChose argon2: already a dependency\n<\/info added on \1>$/
		);
	}, 60000);

	it('reads a note for a subtask from stdin with --file -', () => {
		const result = run(
			['note', '1.1', '--file', '-'],
			'Line one\n  indented line\n'
		);

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe(
			'✓ Added a note to subtask 1.1  Hash passwords\n'
		);
		expect(readTasks()[0].subtasks?.[0].details).toContain(
			'\nLine one\n  indented line\n</info added on'
		);
	}, 60000);

	it('exits 1 with a fix for an unknown task, changing nothing', () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const result = run(['note', '9', 'x']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('✗ Task 9 not found');
		expect(result.stderr).toContain('taskgraph list');
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	}, 60000);

	it('exits 1 with an example for an empty note', () => {
		const result = run(['note', '1', '   ']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('✗ The note is empty');
		expect(result.stderr).toContain('taskgraph note 3 "what you did"');
	}, 60000);

	it('refuses a note over 64 KB from stdin, changing nothing', () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const result = run(['note', '1', '--file', '-'], 'x'.repeat(200 * 1024));

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('✗ The note is over 64 KB');
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	}, 60000);

	it('exits 1 with a fix when --file is missing, changing nothing', () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const result = run(['note', '1', '--file', 'missing.md']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("✗ Couldn't read missing.md: ENOENT");
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	}, 60000);
});
