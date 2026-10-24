/**
 * @fileoverview `init` with a step that fails at level error (#589): each
 * error prints once, no success summary follows, and it exits 1. Run against
 * the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('init when a step fails', () => {
	let dir: string;
	let home: string;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-fail-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-init-fail-home-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('exits 1 without the success summary when .gitignore cannot be written', () => {
		// A folder named .gitignore: the write fails with EISDIR
		fs.mkdirSync(path.join(dir, '.gitignore'));

		const result = spawnSync(
			'node',
			[getCliBinPath(), 'init', '--yes', '--no-git', '--no-aliases'],
			{
				cwd: dir,
				encoding: 'utf8',
				input: '',
				timeout: 60000,
				env: {
					...process.env,
					HOME: home,
					FORCE_COLOR: '0',
					COLUMNS: '80',
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			}
		);

		expect(result.status).toBe(1);
		expect(result.stderr.split('.gitignore:')).toHaveLength(2);
		expect(result.stderr).toContain("Init didn't finish; see the errors above");
		expect(result.stdout).not.toContain('Set up TaskGraph');
		expect(result.stdout).not.toContain('Next steps');
	});
});
