import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binPath = path.join(__dirname, '..', '..', '..', 'dist', 'taskgraph.js');

// Each case runs the built CLI in a throwaway project
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

describe("a project's .env", () => {
	let dir;
	const env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };
	delete env.TASKGRAPH_PROJECT_ROOT;
	const run = (...args) =>
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

	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

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
