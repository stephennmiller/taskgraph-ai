/**
 * @fileoverview Integration tests for `taskgraph research`, run against the
 * built CLI. They cover the checks that run before any AI call, so they
 * never reach a model.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('research command', () => {
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
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-research-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-research-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		run([
			'add-task',
			'--title=Email and password sign-in',
			'--description=Sessions in Postgres'
		]);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('asks for a question with one line and an example, not a help box', () => {
		const result = run(['research']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Research needs a question');
		expect(result.stderr).toContain('taskgraph research "');
		expect(result.stdout + result.stderr).not.toContain('╭');
	});

	it('rejects a task ID that does not exist before asking the model', () => {
		const result = run(['research', 'How should we store sessions?', '--id=9']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Task 9 doesn't exist");
		expect(result.stdout).not.toContain('Researching');
	});

	it('rejects a --save-to subtask that does not exist before asking the model', () => {
		const result = run([
			'research',
			'How should we store sessions?',
			'--save-to=1.4'
		]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Subtask 1.4 doesn't exist");
	});

	it('rejects a bad --detail level', () => {
		const result = run(['research', 'Anything?', '--detail=extreme']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('must be low, medium or high');
	});
});
