/**
 * @fileoverview Integration tests for `prime`, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSON_OUTPUT_SCHEMA_VERSION } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('prime command', () => {
	let dir: string;
	let home: string;

	const run = (args: string[], cwd = dir) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd,
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
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prime-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prime-home-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		if (init.status !== 0) {
			throw new Error(
				`taskgraph init failed (build first with \`npm run build\`): ${init.stderr}`
			);
		}
		const tasksFile = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
		data.master.tasks = [
			{
				title: 'Set up the API',
				status: 'done',
				dependencies: []
			},
			{
				title: 'Add sign-in',
				status: 'in-progress',
				dependencies: ['1'],
				testStrategy: 'Sign-in tests pass'
			},
			{ title: 'Add billing', status: 'pending', dependencies: ['1'] },
			{ title: 'Send receipts', status: 'pending', dependencies: ['3'] }
		].map((task, i) => ({
			id: i + 1,
			description: task.title,
			details: '',
			testStrategy: '',
			priority: 'medium',
			subtasks: [],
			...task
		}));
		fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2));
	}, 60000);

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('prints the task in progress, what is ready and the rules', () => {
		const result = run(['prime']);

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
		const lines = result.stdout.trimEnd().split('\n');
		expect(lines[0]).toBe(
			'TaskGraph tracks work in this project · tag master · 1 of 4 tasks done'
		);
		expect(result.stdout).toContain(
			'In progress\n  2  Add sign-in\n     Done when:\n     - Sign-in tests pass'
		);
		expect(result.stdout).toContain('Ready next\n  3  Add billing\n');
		expect(result.stdout).not.toContain('Send receipts');
		expect(result.stdout).toContain(
			'taskgraph set-status --id=<id> --status=in-progress'
		);
		expect(lines.length).toBeLessThan(40);
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(80);
	});

	it('prints the same context as JSON', () => {
		const result = run(['prime', '--json']);
		const context = JSON.parse(result.stdout);

		expect(result.status).toBe(0);
		expect(context).toMatchObject({
			tag: 'master',
			counts: { total: 4, done: 1 },
			inProgress: [{ id: '2', doneWhen: ['Sign-in tests pass'] }],
			ready: [{ id: '3', title: 'Add billing' }]
		});
		expect(context.rules).toHaveLength(5);
	});

	it('is not one of the grouped commands in --help', () => {
		const result = run(['--help']);

		expect(result.stdout).not.toMatch(/^ {2}prime\b/m);
		expect(result.stdout).toContain('Agents: taskgraph prime');
	});

	it('--unnoted-since reminds about the in-progress task until it has a note', () => {
		const since = new Date(Date.now() - 1000).toISOString();

		const before = run(['prime', '--unnoted-since', since]);
		expect(before.status).toBe(0);
		expect(before.stdout).toContain(
			'Task 2 is still in progress with no note from this session.'
		);
		expect(before.stdout).toContain(
			'taskgraph note 2 "<what you did or decided>"'
		);

		const note = run(['note', '2', 'Wired the sign-in form']);
		expect(note.status).toBe(0);

		const after = run(['prime', '--unnoted-since', since]);
		expect(after.status).toBe(0);
		expect(after.stdout).toBe('');
		expect(
			JSON.parse(run(['prime', '--unnoted-since', since, '--json']).stdout)
		).toEqual({
			schemaVersion: JSON_OUTPUT_SCHEMA_VERSION,
			unnoted: []
		});
	}, 120000);

	it('--unnoted-since exits 1 when the time does not parse', () => {
		const result = run(['prime', '--unnoted-since', 'yesterday']);

		expect(result.status).toBe(1);
		expect(result.stdout).toBe('');
		expect(result.stderr).toContain('ISO time');
	});

	it('exits 1 with a fix outside a TaskGraph project', () => {
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-prime-empty-'));
		try {
			const result = run(['prime', '--project', empty], empty);

			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toContain('taskgraph init');
		} finally {
			fs.rmSync(empty, { recursive: true, force: true });
		}
	});
});
