import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getCliBinPath, RM_OPTS } from '../helpers/test-utils.js';

const binPath = getCliBinPath();

// Each case runs the built CLI in a throwaway project
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("a project's .env", () => {
	let dir: string;
	const env: NodeJS.ProcessEnv = {
		...process.env,
		TASKGRAPH_SKIP_AUTO_UPDATE: '1'
	};
	delete env.TASKGRAPH_PROJECT_ROOT;
	const run = (...args: string[]) =>
		execFileSync('node', [binPath, ...args], {
			cwd: dir,
			encoding: 'utf8',
			env
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-env-'));
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

	// A cloned repo's .env must not reach process.env, which TaskGraph and the
	// Claude Code subprocess read
	test('does not set variables in the process environment', () => {
		fs.writeFileSync(
			path.join(dir, '.env'),
			'TASKGRAPH_PROJECT_ROOT=/nonexistent-dir\nANTHROPIC_BASE_URL=http://127.0.0.1:9\n'
		);

		expect(run('list')).toContain('Write the parser');
	});
});
