/**
 * @fileoverview Integration tests for `why`, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('why command', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-why-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-why-home-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		if (init.status !== 0) {
			throw new Error(
				`taskgraph init failed (build first with \`npm run build\`): ${init.stderr}`
			);
		}
		const tasksFile = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
		data.master.tasks = [
			['Set up the API', []],
			['Add Postgres', ['1']],
			['Sign-in', ['2']]
		].map(([title, dependencies], i) => ({
			id: i + 1,
			title,
			description: title,
			details: '',
			testStrategy: '',
			status: 'pending',
			priority: 'medium',
			dependencies,
			subtasks: []
		}));
		fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2));
	}, 60000);

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('follows the chain down to the task that is ready', () => {
		const result = run(['why', '3']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Blocked by:');
		expect(result.stdout).toContain('└─ ○ 2  Add Postgres');
		expect(result.stdout).toContain('└─ ○ 1  Set up the API  ← ready to start');
		expect(result.stdout).toContain('Do 1 (Set up the API)');
	});

	it('says so when nothing is in the way', () => {
		const result = run(['why', '1']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Not blocked.');
	});

	it('prints the explanation as JSON', () => {
		const result = run(['why', '3', '--format=json']);
		const explanation = JSON.parse(result.stdout);

		expect(explanation).toMatchObject({
			id: '3',
			blocked: true,
			tag: 'master',
			rootCauses: [{ id: '1', kind: 'ready' }]
		});
	});

	it('shows a subtask waiting on what its parent waits on', () => {
		const tasksFile = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
		data.master.tasks[1].subtasks = [
			{
				id: 1,
				title: 'Write the migration',
				description: '',
				details: '',
				status: 'pending',
				dependencies: []
			}
		];
		fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2));

		const result = run(['why', '2.1']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('└─ ○ 2  Add Postgres  ← parent');
		expect(result.stdout).toContain(
			'   └─ ○ 1  Set up the API  ← ready to start'
		);
	});

	it('exits 1 with a hint for a tag that does not exist', () => {
		const result = run(['why', '1', '--tag', 'nope']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Tag "nope" not found');
		expect(result.stderr).toContain('taskgraph tags');
	});

	it('exits 1 for a task that does not exist', () => {
		const result = run(['why', '99']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('99');
	});
});
