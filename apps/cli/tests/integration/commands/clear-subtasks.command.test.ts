/**
 * @fileoverview Integration tests for `taskgraph clear-subtasks`, run against
 * the built CLI in a project with real task data.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const subtask = (id: number) => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	dependencies: []
});

const task = (id: number, title: string, subtaskCount: number) => ({
	id,
	title,
	description: 'd',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: Array.from({ length: subtaskCount }, (_, i) => subtask(i + 1))
});

describe('clear-subtasks command', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const tasksPath = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksPath(), 'utf8')).master.tasks;
	const subtaskCounts = () =>
		readTasks().map((t: { subtasks: unknown[] }) => t.subtasks.length);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-clear-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-clear-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		fs.writeFileSync(
			tasksPath(),
			JSON.stringify({
				master: {
					tasks: [
						task(1, 'Set up the database', 3),
						task(2, 'Build the login API', 1),
						task(3, 'Write docs', 0)
					],
					metadata: { created: '2026-01-01T00:00:00Z' }
				}
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('confirms what it cleared in a few lines', () => {
		const result = run(['clear-subtasks', '--id=1,2']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Cleared 4 subtasks from 2 tasks');
		expect(result.stdout).not.toContain('Subtask Clearing Summary');
		expect(subtaskCounts()).toEqual([0, 0, 0]);
	});

	it('refuses a subtask ID instead of clearing the whole parent', () => {
		// --id=1.2 used to be read as task 1 and remove all three subtasks
		const result = run(['clear-subtasks', '--id=1.2']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('1.2 is a subtask, not a task');
		expect(result.stderr).toContain('remove-subtask --id=1.2');
		expect(subtaskCounts()).toEqual([3, 1, 0]);
	});

	it('clears nothing and exits 1 when an ID is not found', () => {
		const result = run(['clear-subtasks', '--id=1,99']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Task 99 not found; nothing was cleared');
		expect(subtaskCounts()).toEqual([3, 1, 0]);
	});

	it('exits 1 for an ID that is not a number', () => {
		const result = run(['clear-subtasks', '--id=abc']);

		expect(result.status).toBe(1);
		expect(subtaskCounts()).toEqual([3, 1, 0]);
	});

	it('drops dependencies and links on the cleared subtasks (#320)', () => {
		run(['add-dependency', '--id=3', '--depends-on=1.2']);
		run(['add-dependency', '--id=2.1', '--depends-on=1.3', '--type=related']);

		const result = run(['clear-subtasks', '--id=1']);

		expect(result.status).toBe(0);
		const [, second, third] = readTasks();
		expect(third.dependencies).toEqual([]);
		expect(second.subtasks[0].metadata?.taskLinks).toBeUndefined();
		expect(run(['validate-dependencies']).status).toBe(0);
	});

	it('remove-subtask drops dependencies on the removed subtask too', () => {
		run(['add-dependency', '--id=3', '--depends-on=1.2']);

		const result = run(['remove-subtask', '--id=1.2']);

		expect(result.status).toBe(0);
		expect(readTasks()[2].dependencies).toEqual([]);
		expect(run(['validate-dependencies']).status).toBe(0);
	});

	it('says so when there is nothing to clear', () => {
		run(['clear-subtasks', '--all']);

		const again = run(['clear-subtasks', '--all']);

		expect(again.status).toBe(0);
		expect(again.stdout).toContain('No subtasks to clear');
	});
});
