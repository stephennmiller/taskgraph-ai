/**
 * @fileoverview Integration tests for the `[tag] <name>` line, run against
 * the built CLI: a master-only project starts with the result, and the line
 * comes back once there's another tag to tell apart.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

// Each spawn of the built CLI takes seconds on a loaded runner, and setup
// spawns three (init, two add-task); tests spawn up to seven
vi.setConfig({ hookTimeout: 120000, testTimeout: 120000 });

describe('tag indicator', () => {
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

	const firstLine = (stdout: string) =>
		stdout.split('\n').find((line) => line.trim() !== '');

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tag-line-'));
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tag-line-home-'));
		run(['init', '--yes', '--no-aliases', '--no-git']);
		for (const title of ['Set up the API', 'Add Postgres']) {
			run(['add-task', `--title=${title}`, `--description=${title}`]);
		}
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(home, { recursive: true, force: true });
	});

	describe('in a project that only has master', () => {
		it('legacy commands start with their result', () => {
			const added = run(['add-dependency', '--id=2', '--depends-on=1']);
			expect(added.status).toBe(0);
			expect(firstLine(added.stdout)).toBe('✓ Task 2 now depends on task 1');

			const checked = run(['validate-dependencies']);
			expect(checked.status).toBe(0);
			expect(firstLine(checked.stdout)).toBe(
				'✓ No dependency problems · 2 tasks, 1 dependency'
			);
		});

		it('core commands print no tag line', () => {
			for (const args of [['list'], ['next'], ['show', '1']]) {
				const result = run(args);
				expect(result.status).toBe(0);
				expect(result.stdout).not.toContain('[tag]');
			}
		});

		it('core commands do not open with the blank line that followed the tag line', () => {
			run(['add-dependency', '--id=2', '--depends-on=1']);

			for (const args of [
				['next'],
				['show', '1'],
				['show', '1,2'],
				['show', '1,9'],
				['why', '2'],
				['graph']
			]) {
				const result = run(args);
				expect(result.status, args.join(' ')).toBe(0);
				expect(result.stdout.split('\n')[0].trim(), args.join(' ')).not.toBe(
					''
				);
			}
		});
	});

	describe('on a tag other than master', () => {
		beforeEach(() => {
			run(['add-tag', 'feature-auth', '--copy-from-current']);
			run(['use-tag', 'feature-auth']);
		});

		it('legacy commands open with the tag line', () => {
			const result = run(['validate-dependencies']);

			expect(result.status).toBe(0);
			expect(result.stdout.split('\n').slice(0, 2)).toEqual([
				'[tag] feature-auth',
				'✓ No dependency problems · 2 tasks, no dependencies'
			]);
		});

		it('core commands open with the tag line', () => {
			for (const args of [['list'], ['next']]) {
				const result = run(args);
				expect(result.status).toBe(0);
				expect(firstLine(result.stdout)).toBe('[tag] feature-auth');
			}
		});

		it('keeps a blank line between the tag line and the result', () => {
			for (const args of [['next'], ['show', '1'], ['show', '1,2']]) {
				const result = run(args);
				expect(result.status, args.join(' ')).toBe(0);
				expect(result.stdout.split('\n').slice(0, 2), args.join(' ')).toEqual([
					'[tag] feature-auth',
					''
				]);
			}
		});

		it('master shows the line too, once there is another tag', () => {
			run(['use-tag', 'master']);

			const result = run(['validate-dependencies']);

			expect(firstLine(result.stdout)).toBe('[tag] master');
		});
	});
});
