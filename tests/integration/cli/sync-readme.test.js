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

describe('taskgraph sync-readme', () => {
	let dir;
	const run = (...args) =>
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

	afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

	test('writes the task list into README.md instead of crashing', () => {
		run('sync-readme');

		const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
		expect(readme).toContain('Write the parser');
	});
});
