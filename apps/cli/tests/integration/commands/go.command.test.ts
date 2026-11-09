/**
 * @fileoverview `taskgraph go <prd>` against the built CLI with the fake
 * `claude` program (#957): it plans the PRD with `parse-prd --append`, then
 * hands over to `loop`, saying what it resumes on a rerun, and the first
 * step that fails stops it.
 *
 * Needs the build (`npm run build`); skipped when dist/ is missing.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const PRD = `# Notes app

## Notes

Create and edit notes.
`;

describe.skipIf(!built)('go (fake claude)', { timeout: 120000 }, () => {
	let project: string;
	let work: string;

	const run = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd,
			encoding: 'utf8',
			timeout: 90000,
			env: {
				...process.env,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				...env
			}
		});

	beforeEach(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-'));
		work = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-go-work-'));
	});

	afterEach(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(work, { recursive: true, force: true });
	});

	it('stops before init when the PRD is missing', () => {
		const res = run(project, {}, 'go', 'docs/prd.md');

		expect(res.status).toBe(1);
		expect(res.stderr).toContain('docs/prd.md not found');
		expect(fs.existsSync(path.join(project, '.taskgraph'))).toBe(false);
	});

	it('plans the PRD into tasks, then stops at loop without --trust', () => {
		spawnSync('git', ['init', '-q'], { cwd: project });
		expect(run(project, {}, 'init', '--yes').status).toBe(0);
		fs.mkdirSync(path.join(project, 'docs'));
		fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [
				{
					object: {
						tasks: [
							{
								id: 1,
								title: 'Notes',
								description: 'Create and edit notes',
								details: 'Details',
								testStrategy: 'Tests',
								priority: 'medium',
								dependencies: [],
								status: 'pending',
								section: 'notes'
							}
						],
						metadata: null
					}
				}
			]
		});

		const res = run(project, fake.env, 'go', 'docs/prd.md');

		const { tasks } = JSON.parse(
			fs.readFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		).master;
		expect(tasks.map((t: { title: string }) => t.title)).toEqual(['Notes']);
		// loop asks before turning permission prompts off; no terminal here
		expect(res.status).toBe(1);
		expect(`${res.stdout}${res.stderr}`).toContain('--trust');
		// A first run has nothing to resume
		expect(res.stdout).not.toContain('Resuming');
	});

	it('says what it resumes on a rerun, before loop', () => {
		spawnSync('git', ['init', '-q'], { cwd: project });
		expect(run(project, {}, 'init', '--yes').status).toBe(0);
		const file = path.join(project, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(file, 'utf8'));
		const task = (id: string, status: string) => ({
			id,
			title: `Task ${id}`,
			description: 'd',
			status,
			priority: 'medium',
			dependencies: [],
			subtasks: []
		});
		data.master.tasks = [
			task('1', 'done'),
			task('2', 'in-progress'),
			task('3', 'pending')
		];
		fs.writeFileSync(file, JSON.stringify(data));
		fs.mkdirSync(path.join(project, 'docs'));
		fs.writeFileSync(path.join(project, 'docs', 'prd.md'), PRD);
		const fake = installFakeClaude({
			projectDir: project,
			workDir: work,
			replies: [{ object: { tasks: [], metadata: null } }]
		});

		const res = run(project, fake.env, 'go', 'docs/prd.md');

		expect(res.stdout).toContain(
			'Resuming: 1 done, task 2 in progress, 1 pending'
		);
		expect(res.status).toBe(1);
	});
});
