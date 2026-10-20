/**
 * @fileoverview Integration tests for `taskgraph complexity-report`, run
 * against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('complexity-report command', () => {
	let dir: string;
	let home: string;

	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			// No stdin: the command used to wait for a y/n answer here
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

	const reportPath = () =>
		path.join(dir, '.taskgraph', 'reports', 'task-complexity-report.json');

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-complexity-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-complexity-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('says how to create a report when there is none, without asking', () => {
		const result = run(['complexity-report']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No complexity report for this tag yet');
		expect(result.stderr).toContain('taskgraph analyze-complexity');
		expect(result.stdout).not.toContain('(y/n)');
	});

	it('shows each task with its score and reasoning, within 80 columns', () => {
		fs.writeFileSync(
			reportPath(),
			JSON.stringify({
				meta: { generatedAt: '2026-10-20T15:30:00.000Z', usedResearch: false },
				complexityAnalysis: [
					{
						taskId: 3,
						taskTitle: 'Email and password sign-in with sessions',
						complexityScore: 7,
						recommendedSubtasks: 6,
						expansionPrompt: 'Subtasks: (1) add express-session '.repeat(20),
						reasoning: 'Password hashing, sessions and an auth guard. '.repeat(
							4
						)
					}
				]
			})
		);

		const result = run(['complexity-report']);

		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(
			/3\s+Email and password sign-in with sessions\s+● 7\s+6 subtasks/
		);
		expect(result.stdout).toContain(
			'Password hashing, sessions and an auth guard.'
		);
		// The expansion prompt is for expand, not for reading here
		expect(result.stdout).not.toContain('add express-session');
		for (const line of result.stdout.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});
