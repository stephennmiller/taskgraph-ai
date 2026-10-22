/**
 * @fileoverview Integration tests for `taskgraph init --from-taskmaster`
 * against the built CLI and a copy of tm-core's fixture Task Master project.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

const fixture = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../../../packages/tm-core/tests/fixtures/taskmaster-project'
);

describe('init --from-taskmaster', () => {
	let dir: string;
	let home: string;

	// HOME points at a temp folder so init can't touch the real shell config
	const run = (args: string[]) =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});
	const importArgs = [
		'init',
		'--from-taskmaster',
		'--yes',
		'--no-aliases',
		'--no-git'
	];

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-import-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-import-home-'));
		fs.cpSync(fixture, dir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('prints what moved and the next step, and the tags are usable', () => {
		const result = run(importArgs);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			'✓ Imported 4 tasks in 2 tags, docs and reports from .taskmaster/'
		);
		expect(result.stdout).toContain(
			'.taskmaster/ is unchanged · Next: taskgraph next'
		);
		// The usual "write a PRD" steps don't apply to a project with tasks
		expect(result.stdout).not.toContain('Next steps');

		const tags = run(['tags']);
		expect(tags.stdout).toMatch(/feature-auth\s+1/);
		expect(tags.stdout).toMatch(/master\s+3/);
	});

	it('refuses with a fix hint when .taskgraph/ already has tasks', () => {
		run(importArgs);

		const again = run(importArgs);

		expect(again.status).toBe(1);
		expect(again.stderr).toContain(
			'✗ .taskgraph/ already has 4 tasks; the import would replace them'
		);
		expect(again.stderr).toContain(
			'Move .taskgraph/tasks/tasks.json aside first'
		);
	});

	it('refuses before writing anything when there is no .taskmaster/', () => {
		fs.rmSync(path.join(dir, '.taskmaster'), { recursive: true });

		const result = run(importArgs);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('No .taskmaster/ folder');
		expect(fs.existsSync(path.join(dir, '.taskgraph'))).toBe(false);
	});

	it('lists the import in a dry run and writes nothing', () => {
		const result = run([...importArgs, '--dry-run']);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain(
			'import tasks, docs, reports and settings from .taskmaster/'
		);
		expect(fs.existsSync(path.join(dir, '.taskgraph'))).toBe(false);
	});
});
