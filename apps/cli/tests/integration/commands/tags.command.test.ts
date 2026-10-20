/**
 * @fileoverview Integration tests for `taskgraph tags` and the deprecated
 * tag aliases, run against the built CLI.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('tags command', () => {
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

	const all = (result: { stdout: string; stderr: string }) =>
		result.stdout + result.stderr;

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tags-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tags-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		for (const title of ['Set up the API', 'Add Postgres']) {
			run(['add-task', `--title=${title}`, `--description=${title}`]);
		}
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	it('lists tags as rows that fit 80 columns', () => {
		const result = run(['tags']);

		expect(result.status).toBe(0);
		expect(result.stdout.trimEnd().split('\n')).toEqual([
			'  Tag       Tasks  Ready  Done',
			'● master        2      2     0'
		]);
	});

	it('runs add, use, rename, copy and remove with one result line each', () => {
		const added = run(['tags', 'add', 'feature-auth']);
		expect(added.stdout).toContain('✓ Created tag feature-auth');

		const used = run(['tags', 'use', 'feature-auth']);
		expect(used.stdout).toContain('✓ Switched to feature-auth · 0 tasks');

		const renamed = run(['tags', 'rename', 'feature-auth', 'feature-login']);
		expect(renamed.stdout).toContain(
			'✓ Renamed feature-auth to feature-login · current tag'
		);

		const copied = run(['tags', 'copy', 'master', 'backup']);
		expect(copied.stdout).toContain('✓ Copied master to backup · 2 tasks');

		const removed = run(['tags', 'remove', 'backup', '--yes']);
		expect(removed.stdout).toContain('✓ Deleted tag backup and its 2 tasks');

		for (const result of [added, used, renamed, copied, removed]) {
			expect(result.status).toBe(0);
			expect(all(result)).not.toContain('╭');
			expect(all(result)).not.toContain('Successfully');
		}
	});

	it('prints an error once, with a hint', () => {
		run(['tags', 'add', 'feature-auth']);
		const result = run(['tags', 'add', 'feature-auth']);

		expect(result.status).toBe(1);
		expect(result.stderr.match(/already exists/g)).toHaveLength(1);
		expect(result.stderr).toContain('Run taskgraph tags to see your tags');
	});

	it('refuses to delete a tag with tasks without a terminal or --yes', () => {
		run(['tags', 'copy', 'master', 'backup']);
		const result = run(['tags', 'remove', 'backup']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'Deleting tag backup and its 2 tasks needs confirmation'
		);
		expect(result.stderr).toContain('Pass --yes');
		expect(run(['tags']).stdout).toContain('backup');
	});

	it('legacy aliases warn in one line and print no help box on error', () => {
		const result = run(['add-tag', 'Bad/Name']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			'⚠ add-tag is deprecated; use taskgraph tags add'
		);
		expect(result.stderr).toContain('"Bad/Name" isn\'t a valid tag name');
		expect(all(result)).not.toContain('Add Tag Command Help');
		expect(all(result)).not.toContain('╭');
	});
});
