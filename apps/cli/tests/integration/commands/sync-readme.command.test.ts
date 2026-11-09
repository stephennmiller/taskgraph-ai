import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCliBinPath, RM_OPTS } from '../../helpers/test-utils.js';

const binPath = getCliBinPath();

// Each case runs the built CLI in a throwaway project
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe('taskgraph sync-readme', () => {
	let dir: string;
	const run = (...args: string[]) =>
		execFileSync('node', [binPath, ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-sync-readme-'));
		run('init', '--yes');
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [
						{
							id: 1,
							title: 'Write the parser',
							description: 'Parse the input',
							status: 'pending',
							priority: 'high',
							dependencies: [],
							subtasks: []
						}
					]
				}
			})
		);
	});

	afterEach(() => fs.rmSync(dir, RM_OPTS));

	test('writes the task list into README.md instead of crashing', () => {
		run('sync-readme');

		const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
		expect(readme).toContain('Write the parser');
	});

	test('refuses an unknown --status, like list, and writes nothing', () => {
		expect(() => run('sync-readme', '--status', 'bogus')).toThrow(/bogus/);

		expect(fs.existsSync(path.join(dir, 'README.md'))).toBe(false);
	});

	test('says the default tag is the current one', () => {
		expect(run('sync-readme', '--help')).toContain('default: the current tag');
	});
});
