/**
 * @fileoverview A tag whose tasks.json holds a task with an empty description,
 * as `remove-subtask --convert` wrote before #405, still loads (#412).
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const fixture = path.resolve(
	__dirname,
	'../fixtures/empty-description-tasks.json'
);

describe('a task with an empty description', () => {
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

	// Every test only reads the tag, so they share one project
	beforeAll(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-empty-desc-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-empty-desc-home-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		if (init.status !== 0) {
			throw new Error(
				`taskgraph init failed (build first with \`npm run build\`): ${init.stderr}`
			);
		}
		fs.copyFileSync(
			fixture,
			path.join(dir, '.taskgraph', 'tasks', 'tasks.json')
		);
	}, 60000);

	afterAll(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('still lists the tag', () => {
		const result = run(['list']);

		expect(result.stderr).not.toContain('Task description is required');
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('Set up the API');
		expect(result.stdout).toContain('Add health check');
	});

	it.each([['graph'], ['why', '2'], ['next']])('still runs %s', (...args) => {
		const result = run(args);

		expect(result.stderr).not.toContain('Task description is required');
		expect(result.status).toBe(0);
	});

	it('gives the task its title as its description', () => {
		const result = run(['list', '--format=json']);
		const { tasks } = JSON.parse(result.stdout);

		expect(tasks.find((t: { id: string }) => t.id === '2')).toMatchObject({
			title: 'Add health check',
			description: 'Add health check'
		});
	});

	it('shows the same description as list', () => {
		const result = run(['show', '2', '--json']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('"description": "Add health check"');
	});

	it('leaves tasks.json as it was', () => {
		const tasksFile = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');

		run(['list']);

		expect(fs.readFileSync(tasksFile, 'utf8')).toBe(
			fs.readFileSync(fixture, 'utf8')
		);
	});
});
