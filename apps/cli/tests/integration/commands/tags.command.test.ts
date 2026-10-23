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
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it
} from 'vitest';
import { copyProject, getCliBinPath } from '../../helpers/test-utils.js';

describe('tags command', () => {
	let dir: string;
	let home: string;

	const run = (args: string[], columns = '80') =>
		spawnSync('node', [getCliBinPath(), ...args], {
			cwd: dir,
			encoding: 'utf8',
			input: '',
			timeout: 30000,
			env: {
				...process.env,
				HOME: home,
				FORCE_COLOR: '0',
				COLUMNS: columns,
				TASKGRAPH_SKIP_AUTO_UPDATE: '1'
			}
		});

	const all = (result: { stdout: string; stderr: string }) =>
		result.stdout + result.stderr;

	// Set the project up once and copy it into each test's folder: every spawn
	// of the built CLI takes seconds on a loaded runner
	let template: string;
	let templateHome: string;

	beforeAll(() => {
		template = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tags-tpl-'));
		templateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tags-home-'));
		dir = template;
		home = templateHome;
		expect(run(['init', '--yes', '--no-aliases', '--no-git']).status).toBe(0);
		for (const title of ['Set up the API', 'Add Postgres']) {
			expect(
				run(['add-task', `--title=${title}`, `--description=${title}`]).status
			).toBe(0);
		}
	}, 60000);

	afterAll(() => {
		fs.rmSync(template, { recursive: true, force: true });
		fs.rmSync(templateHome, { recursive: true, force: true });
	});

	beforeEach(() => {
		dir = copyProject(template, 'tm-tags-');
		home = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-tags-home-'));
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

	// Regression for #184: piped output ignored COLUMNS and always used 80
	it('sizes piped output to COLUMNS', () => {
		run([
			'tags',
			'add',
			'feature-authentication-and-session-management',
			'--description=Signing users in, refreshing sessions and logging out'
		]);
		const width = (columns: string) => {
			const result = run(['tags', '--show-metadata'], columns);
			expect(result.status).toBe(0);
			return Math.max(
				...result.stdout
					.trimEnd()
					.split('\n')
					.map((l) => l.length)
			);
		};

		expect(width('60')).toBeLessThanOrEqual(60);
		expect(width('120')).toBeGreaterThan(80);
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

	it('creates a tag named after the current git branch with --from-branch', () => {
		const git = (...args: string[]) =>
			spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
		git('init', '-q');
		git('checkout', '-q', '-b', 'feature/login');
		// A branch with no commits yet reads as HEAD, so give it one
		git(
			'-c',
			'user.name=Test',
			'-c',
			'user.email=test@example.com',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			'init'
		);

		const added = run(['tags', 'add', '--from-branch', '--description', 'x']);

		expect(added.status, all(added)).toBe(0);
		expect(run(['tags']).stdout).toContain('feature-login');
		const state = JSON.parse(
			fs.readFileSync(path.join(dir, '.taskgraph', 'state.json'), 'utf8')
		);
		expect(state.branchTagMapping['feature/login']).toBe('feature-login');
	});

	it('rejects a name together with --from-branch', () => {
		const result = run(['tags', 'add', 'feature-auth', '--from-branch']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('not both');
	});

	it('prints an error once, with a hint', () => {
		run(['tags', 'add', 'feature-auth']);
		const result = run(['tags', 'add', 'feature-auth']);

		expect(result.status).toBe(1);
		expect(result.stderr.match(/already exists/g)).toHaveLength(1);
		expect(result.stderr).toContain('Run taskgraph tags to see your tags');
	});

	// Regression: #384, a typo looked like an empty tag and suggested adding tasks
	it('list and next fail on a tag that does not exist', () => {
		for (const command of ['list', 'next']) {
			const result = run([command, '--tag', 'nosuch']);

			expect(result.status).toBe(1);
			expect(result.stderr).toContain('Tag "nosuch" not found');
			expect(result.stderr).toContain('Run taskgraph tags to see your tags');
			expect(result.stdout).not.toContain('No tasks found');
		}
	});

	// Prototype members aren't tags (#386 own-key lookups)
	it('list fails on a tag named after an Object member', () => {
		const result = run(['list', '--tag', 'toString']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('Tag "toString" not found');
	});

	// The tag check reads tasks.json first; a parse error keeps its message
	it('list --tag on a corrupt tasks.json says the file is invalid', () => {
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'tasks', 'tasks.json'),
			'{ "master": '
		);

		const result = run(['list', '--tag', 'other']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("isn't valid JSON");
		expect(result.stderr).not.toContain('Failed to get tags');
	});

	// After a git checkout the active tag can be missing from tasks.json;
	// prime runs at session start and passes the active tag itself
	it('prime still works when the active tag is missing from tasks.json', () => {
		const statePath = path.join(dir, '.taskgraph', 'state.json');
		const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
		fs.writeFileSync(
			statePath,
			JSON.stringify({ ...state, currentTag: 'gone' })
		);

		const result = run(['prime']);

		expect(result.status).toBe(0);
		expect(result.stderr).not.toContain('not found');
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
