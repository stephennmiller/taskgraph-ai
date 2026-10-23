/**
 * @fileoverview Integration tests for turning a subtask into a task
 * (`remove-subtask --convert`, `move --to=<new id>`), run against the built CLI
 * in a project with real task data.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('converting a subtask with no description into a task', () => {
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
	const readTask = (id: number) =>
		JSON.parse(fs.readFileSync(tasksPath(), 'utf8')).master.tasks.find(
			(t: { id: number }) => t.id === id
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-convert-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-convert-home-'));
		expect(run(['init', '--yes', '--no-aliases', '--no-git']).status).toBe(0);
		// `add-subtask` without --description stores no description
		fs.writeFileSync(
			tasksPath(),
			JSON.stringify({
				master: {
					tasks: [
						{
							id: 1,
							title: 'Parent',
							description: 'P',
							status: 'pending',
							priority: 'medium',
							dependencies: [],
							details: '',
							testStrategy: '',
							subtasks: [
								{
									id: 1,
									title: 'Child',
									description: '',
									status: 'pending',
									dependencies: []
								}
							]
						}
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

	it('remove-subtask --convert makes a task that list can load', () => {
		expect(run(['remove-subtask', '--id=1.1', '--convert']).status).toBe(0);

		expect(readTask(2).description).toBe('Child');
		const list = run(['list']);
		expect(list.stderr).not.toContain('description is required');
		expect(list.status).toBe(0);
		expect(list.stdout).toContain('Child');
	});

	it('move to a new task ID makes a task that list can load', () => {
		expect(run(['move', '--from=1.1', '--to=5']).status).toBe(0);

		expect(readTask(5).description).toBe('Child');
		const list = run(['list']);
		expect(list.stderr).not.toContain('description is required');
		expect(list.status).toBe(0);
	});
});
