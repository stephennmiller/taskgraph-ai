/**
 * @fileoverview `add-subtask` and `move` run against the built CLI: the flags
 * the legacy commands took still parse, and a failed batch move changes
 * nothing.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('add-subtask and move', () => {
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
	const read = () => fs.readFileSync(tasksPath(), 'utf8');
	const task = (id: number) => ({
		id,
		title: `Task ${id}`,
		description: '-',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: []
	});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-move-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-move-home-'));
		expect(run(['init', '--yes', '--no-aliases', '--no-git']).status).toBe(0);
		fs.writeFileSync(
			tasksPath(),
			JSON.stringify({
				master: {
					tasks: [task(1), task(2), task(3)],
					metadata: { created: '2026-01-01T00:00:00Z' }
				}
			})
		);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('accept the old --file naming the project tasks file, and --generate', () => {
		const added = run([
			'add-subtask',
			'--parent=1',
			'--title=Child',
			'-f',
			'.taskgraph/tasks/tasks.json',
			'--generate'
		]);
		const moved = run([
			'move',
			'--from=3',
			'--to=7',
			'--file=.taskgraph/tasks/tasks.json'
		]);

		expect(added.status).toBe(0);
		expect(moved.status).toBe(0);
		const tasks = JSON.parse(read()).master.tasks;
		expect(tasks[0].subtasks).toHaveLength(1);
		expect(tasks.map((t: { id: string }) => String(t.id))).toEqual([
			'1',
			'2',
			'7'
		]);
	});

	it('refuse --file naming another file and leave the project alone', () => {
		const before = read();

		const result = run(['move', '--from=3', '--to=7', '--file=other.json']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('--file is no longer supported');
		expect(read()).toBe(before);
	});

	it('move nothing and exit 1 when one pair of a batch fails', () => {
		const before = read();

		const result = run(['move', '--from=3,2', '--to=8,1']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Task 1 already exists');
		expect(read()).toBe(before);
	});
});
