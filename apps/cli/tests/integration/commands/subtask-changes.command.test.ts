/**
 * @fileoverview Integration tests for what `add-subtask`, `remove-subtask`
 * and `remove-task` print, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const BOX = /[╭╮╰╯│]/;

const task = (id: number, title: string, subtasks: string[] = []) => ({
	id,
	title,
	description: 'd',
	status: 'pending',
	priority: 'medium',
	dependencies: [],
	details: '',
	testStrategy: '',
	subtasks: subtasks.map((subtaskTitle, i) => ({
		id: i + 1,
		title: subtaskTitle,
		description: '',
		status: 'pending',
		dependencies: [],
		details: ''
	}))
});

describe('add-subtask, remove-subtask and remove-task output', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				COLUMNS: '80',
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const tasksPath = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksPath(), 'utf8')).master.tasks;
	const lines = (text: string) => text.trimEnd().split('\n');

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-subtask-out-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-subtask-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		fs.writeFileSync(
			tasksPath(),
			JSON.stringify({
				master: {
					tasks: [
						task(1, 'Set up the database schema', [
							'Create the users table',
							'Add indexes'
						]),
						task(2, 'Build the login API'),
						task(3, 'Write docs')
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

	it('add-subtask confirms the new subtask and one next step', () => {
		const res = run([
			'add-subtask',
			'--parent=1',
			'--title=Write the migration',
			'--dependencies=1.1'
		]);

		expect(res.status).toBe(0);
		expect(lines(res.stdout)).toEqual([
			'✓ Added subtask 1.3  Write the migration',
			'  depends on 1.1',
			'Next: taskgraph set-status 1.3 in-progress'
		]);
		expect(res.stderr).toBe('');
	});

	it('add-subtask --task-id says which task moved', () => {
		const res = run(['add-subtask', '--parent=1', '--task-id=3']);

		expect(res.status).toBe(0);
		expect(lines(res.stdout)).toEqual([
			'✓ Task 3 is now subtask 1.3  Write docs'
		]);
	});

	it('add-subtask without --title or --task-id errors with an example and writes nothing', () => {
		const before = fs.readFileSync(tasksPath(), 'utf8');
		const res = run(['add-subtask', '--parent=1']);

		expect(res.status).toBe(1);
		expect(res.stdout).toBe('');
		expect(res.stderr).toContain('✗ add-subtask needs --title');
		expect(res.stderr).toContain('taskgraph add-subtask --parent=1 --title=');
		expect(res.stderr).not.toMatch(BOX);
		expect(fs.readFileSync(tasksPath(), 'utf8')).toBe(before);
	});

	it('add-subtask without --parent errors with an example', () => {
		const res = run(['add-subtask', '--title=Orphan']);

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('✗ add-subtask needs --parent');
		expect(res.stderr).not.toMatch(BOX);
	});

	it('remove-subtask confirms each removal in one line', () => {
		const res = run(['remove-subtask', '--id=1.1,1.2']);

		expect(res.status).toBe(0);
		expect(lines(res.stdout)).toEqual([
			'✓ Removed subtask 1.1',
			'✓ Removed subtask 1.2'
		]);
		expect(readTasks()[0].subtasks ?? []).toEqual([]);
	});

	it('remove-subtask --convert names the new task once', () => {
		const res = run(['remove-subtask', '--id=1.2', '--convert']);

		expect(res.status).toBe(0);
		expect(lines(res.stdout)).toEqual([
			'✓ Subtask 1.2 is now task 4  Add indexes'
		]);
	});

	it('remove-subtask checks every ID before removing any', () => {
		const res = run(['remove-subtask', '--id=1.1,2']);

		expect(res.status).toBe(1);
		expect(res.stdout).toBe('');
		expect(res.stderr).toContain(`✗ "2" isn't a subtask ID`);
		expect(res.stderr).toContain('taskgraph remove-task --id=2');
		expect(res.stderr).not.toMatch(BOX);
		expect(readTasks()[0].subtasks).toHaveLength(2);
		for (const line of lines(res.stderr)) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('remove-task --yes confirms in one line', () => {
		const res = run(['remove-task', '--id=2', '--yes']);

		expect(res.status).toBe(0);
		expect(lines(res.stdout)).toEqual(['✓ Removed task 2']);
		expect(readTasks().map((t: { id: string }) => t.id)).toEqual(['1', '3']);
	});
});
