/**
 * @fileoverview What `taskgraph add-task` prints, run through the built CLI.
 * The AI path uses the fake `claude` program, so no real model is called.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installFakeClaude } from '../../fakes/install-fake-claude.mjs';
import { getCliBinPath } from '../../helpers/test-utils.js';

const binPath = getCliBinPath();
const built = fs.existsSync(binPath);
if (!built && process.env.CI) {
	throw new Error(
		`${binPath} is missing; run npm run build before these tests in CI`
	);
}

const BOXES = /[╭╮╰╯│┌┐└┘├┤]/;

describe.skipIf(!built)('add-task command output', () => {
	let project: string;
	let work: string;
	let env: NodeJS.ProcessEnv;

	const addTask = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, 'add-task', ...args], {
			cwd: project,
			encoding: 'utf8',
			timeout: 25000,
			env
		});

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-add-task-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-add-task-work-'));
		env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };
		spawnSync('git', ['init', '-q'], { cwd: project });
		const init = spawnSync(process.execPath, [binPath, 'init', '--yes'], {
			cwd: project,
			encoding: 'utf8',
			env
		});
		expect(init.status).toBe(0);
		fs.writeFileSync(
			path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({ id: 1, title: 'Set up the database schema' }),
						createTask({ id: 2, title: 'Email and password sign-in' })
					]
				}),
				null,
				2
			)
		);
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('confirms a manual task in one ✓ line, its dependency and one next step', () => {
		const res = addTask(
			'--title=Write the README',
			'--description=Setup, scripts and env vars',
			'--dependencies=1'
		);

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			[
				'✓ Added task 3  Write the README · medium priority',
				'  Depends on  1  Set up the database schema',
				'Next: taskgraph show 3 to read it, or taskgraph expand --id=3 to break it down'
			].join('\n')
		);
		expect(res.stdout).not.toMatch(BOXES);
		expect(res.stdout).not.toContain('Successfully');
		expect(res.stdout).not.toContain('Using manually provided task data');
	});

	it('warns once about a dependency that does not exist and adds the task without it', () => {
		const res = addTask(
			'--title=Write the README',
			'--description=Setup, scripts and env vars',
			'--dependencies=1,9'
		);

		expect(res.status).toBe(0);
		const output = res.stdout + res.stderr;
		expect(output).toContain(
			"Task 9 doesn't exist; adding the task without that dependency"
		);
		expect(output).not.toContain('Removing invalid dependencies');
		expect(res.stdout).toContain('  Depends on  1  Set up the database schema');
	});

	it('keeps the dependencies you passed and marks the ones the AI added, within 80 columns', () => {
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [
				{
					object: {
						title: 'Export bookmarks as a Netscape HTML file',
						description:
							'Download all bookmarks in the format browsers import.',
						details: 'Add GET /api/bookmarks/export that streams the file.',
						testStrategy: 'Import the file into Firefox and Chrome.',
						dependencies: [2]
					}
				}
			]
		});
		env = { ...env, ...fake.env };

		const res = addTask('--prompt=Export bookmarks', '--dependencies=1');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			[
				'✓ Added task 3  Export bookmarks as a Netscape HTML file · medium priority',
				'  Depends on  1  Set up the database schema',
				'              2  Email and password sign-in  added by AI'
			].join('\n')
		);
		const saved = JSON.parse(
			fs.readFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		);
		expect(
			saved.master.tasks.find((t: { id: string }) => t.id === '3').dependencies
		).toEqual(['1', '2']);
		expect(res.stdout).not.toMatch(BOXES);
		expect(res.stdout).not.toContain('Context Analysis');
		const lines = res.stdout.split('\n');
		expect(lines.filter((line) => line.startsWith('Next: '))).toHaveLength(1);
		expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
			80
		);
	});
});
