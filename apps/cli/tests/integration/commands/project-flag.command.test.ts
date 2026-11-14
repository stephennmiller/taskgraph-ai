/**
 * @fileoverview `--project` on the commands that lacked it (#1149), run
 * against the built CLI from a folder that is not a project. The AI commands
 * take it the same way; `program.spec.ts` checks every command declares it.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('--project from another folder', () => {
	let project: string;
	let elsewhere: string;

	const run = (cwd: string, args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: elsewhere,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	beforeAll(() => {
		project = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-flag-'));
		elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-project-else-'));
		const init = run(project, ['init', '--yes', '--no-aliases', '--no-git']);
		if (init.status !== 0) {
			throw new Error(
				`taskgraph init failed (build first with \`npm run build\`): ${init.stderr}`
			);
		}
	}, 60000);

	afterAll(() => {
		fs.rmSync(project, { recursive: true, force: true });
		fs.rmSync(elsewhere, { recursive: true, force: true });
	});

	// In order: the tag one adds is the tag the next uses
	it.each([
		[['tags', '--project']],
		[['tags', 'add', 'feature', '--project']],
		// After the subcommand's own argument, and in the short form
		[['tags', 'use', 'feature', '-p']],
		[['add-tag', 'old-name', '--project']],
		[['lang', '--project']],
		[['models', '--project']],
		[['sync-readme', '--project']]
	])('%j works on the project named', (args) => {
		const result = run(elsewhere, [...args, project]);

		expect(result.stderr.replace(/^⚠ add-tag is deprecated.*\n/, '')).toBe('');
		expect(result.status).toBe(0);
	});

	it('changed the project named, not the folder it ran in', () => {
		const { feature } = JSON.parse(
			fs.readFileSync(
				path.join(project, '.taskgraph', 'tasks', 'tasks.json'),
				'utf8'
			)
		);

		expect(feature).toBeDefined();
		expect(fs.existsSync(path.join(project, 'README.md'))).toBe(true);
		expect(fs.existsSync(path.join(elsewhere, 'README.md'))).toBe(false);
	});

	it('says so when the folder named is not a project', () => {
		const result = run(elsewhere, ['tags', 'use', 'feature', '-p', elsewhere]);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(`No TaskGraph project at ${elsewhere}`);
	});
});
