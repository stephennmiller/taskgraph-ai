/**
 * @fileoverview `taskgraph doctor` against the built CLI: it runs outside a
 * project, exits 1 when a check fails, and prints JSON with --json. PATH
 * holds only a fake `claude`, so the result doesn't depend on this machine.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

describe('doctor command', () => {
	let dir: string;
	let bin: string;

	/** A `claude` on PATH that answers like a signed-in Claude Code */
	const fakeClaude = (plugins: object[]) => {
		const file = path.join(bin, 'claude');
		fs.writeFileSync(
			file,
			[
				'#!/bin/sh',
				'case "$*" in',
				'  "--version") echo "2.1.309 (Claude Code)";;',
				`  "auth status --json") echo '{"loggedIn":true}';;`,
				`  "plugin list --json") echo '${JSON.stringify(plugins)}';;`,
				'  *) exit 1;;',
				'esac'
			].join('\n')
		);
		fs.chmodSync(file, 0o755);
	};

	const run = (...args: string[]) =>
		spawnSync(process.execPath, [getCliBinPath(), 'doctor', ...args], {
			cwd: dir,
			encoding: 'utf8',
			timeout: 30000,
			env: {
				...process.env,
				PATH: bin,
				// No Claude Code config, so no MCP server from this machine's
				CLAUDE_CONFIG_DIR: bin,
				FORCE_COLOR: '0',
				COLUMNS: '80',
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				TASKGRAPH_PROJECT_ROOT: ''
			}
		});

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-doctor-'));
		bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-doctor-bin-'));
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
		fs.rmSync(bin, { recursive: true, force: true });
	});

	// Without a claude on PATH, doctor asks the one bundled in node_modules,
	// which a test must not run; runDoctor's spec covers both cases
	it('runs outside a project and exits 1 with a fix for each failed check', () => {
		fakeClaude([]);
		const result = run();

		expect(result.status).toBe(1);
		expect(result.stderr).toBe('');
		expect(result.stdout).toContain('✗ Plugin          not installed');
		expect(result.stdout).toContain('✗ Project         none in this folder');
		expect(result.stdout).toContain('Run taskgraph init to set one up');
	});

	it('exits 0 when every check passes, and lists the optional MCP server', () => {
		fs.mkdirSync(path.join(dir, '.taskgraph'));
		fs.writeFileSync(path.join(dir, '.taskgraph', 'config.json'), '{}');
		const plugin = path.join(bin, 'plugin');
		fs.mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true });
		fs.writeFileSync(
			path.join(plugin, '.claude-plugin', 'plugin.json'),
			JSON.stringify({
				version: '1.2.3',
				metadata: { taskgraphCli: '>=0.0.1' }
			})
		);
		fakeClaude([
			{ id: 'taskgraph@taskgraph', enabled: true, installPath: plugin }
		]);

		const result = run();

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('✓ Claude sign-in  signed in');
		expect(result.stdout).toContain('✓ Plugin          1.2.3');
		expect(result.stdout).toContain(
			'– MCP server      optional; add it with taskgraph init --mcp'
		);
	});

	it('prints the checks as JSON with --json', () => {
		fakeClaude([]);

		const result = run('--json');
		const report = JSON.parse(result.stdout);

		expect(result.status).toBe(1);
		expect(report.ok).toBe(false);
		expect(
			report.checks.find((check: { name: string }) => check.name === 'plugin')
		).toEqual({ name: 'plugin', status: 'fail', problem: 'not-installed' });
	});

	describe('in a project with broken data files', () => {
		const tasksFile = () => path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		const task = (id: string, fields: object = {}) => ({
			id,
			title: `Task ${id}`,
			description: '',
			status: 'pending',
			priority: 'medium',
			dependencies: [],
			subtasks: [],
			...fields
		});
		const check = (stdout: string, name: string) =>
			JSON.parse(stdout).checks.find((c: { name: string }) => c.name === name);

		beforeEach(() => {
			fakeClaude([]);
			fs.mkdirSync(path.dirname(tasksFile()), { recursive: true });
			fs.writeFileSync(path.join(dir, '.taskgraph', 'config.json'), '{}');
			fs.writeFileSync(
				tasksFile(),
				JSON.stringify({
					master: {
						tasks: [
							task('1', {
								status: 'finished',
								subtasks: [{ id: '1', title: 'Open', status: 'pending' }]
							}),
							task('2', { dependencies: ['99'] })
						],
						metadata: {}
					}
				})
			);
		});

		it('fails on a conflict-marked config.json and names the file and line', () => {
			fs.writeFileSync(
				path.join(dir, '.taskgraph', 'config.json'),
				'{\n<<<<<<< HEAD\n  "a": 1\n=======\n  "a": 2\n>>>>>>> theirs\n}\n'
			);

			const result = run();

			expect(result.status).toBe(1);
			expect(result.stdout).toContain("✗ Data files      1 can't be read");
			expect(result.stdout).toContain(
				'.taskgraph/config.json has a git conflict marker on line 2'
			);
		});

		it('reports task problems in text and, the same ones, in --json', () => {
			const text = run();
			const json = run('--json');

			expect(text.status).toBe(1);
			expect(text.stdout).toContain(
				'✗ Tasks           2 problems in .taskgraph/tasks/tasks.json'
			);
			expect(json.status).toBe(1);
			const findings = check(json.stdout, 'tasks').findings;
			expect(findings.map((f: { kind: string }) => f.kind)).toEqual([
				'unknown-status',
				'dependency'
			]);
			for (const finding of findings) {
				expect(text.stdout).toContain(finding.message);
			}
			expect(JSON.parse(json.stdout).schemaVersion).toBeGreaterThan(0);
		});

		it('repairs them with --fix, lists the changes, and then passes that check', () => {
			const fixed = run('--fix');

			expect(fixed.stdout).toContain(
				'✓ Repaired 1 problem in .taskgraph/tasks/tasks.json'
			);
			expect(fixed.stdout).toContain(
				"Task 2 no longer depends on 99, which doesn't exist"
			);
			expect(fixed.stdout).toContain(
				'✗ Tasks           1 problem in .taskgraph/tasks/tasks.json'
			);
			expect(fixed.status).toBe(1);
			const saved = JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
			expect(saved.master.tasks[1].dependencies).toEqual([]);

			// The fix doctor names for what is left, then a clean run
			const set = spawnSync(
				process.execPath,
				[getCliBinPath(), 'set-status', '--id=1', '--status=pending'],
				{
					cwd: dir,
					encoding: 'utf8',
					env: { ...process.env, PATH: bin, TASKGRAPH_PROJECT_ROOT: '' }
				}
			);
			expect(set.status).toBe(0);
			expect(check(run('--json').stdout, 'tasks').status).toBe('pass');
			expect(run('--fix').stdout).not.toContain('Repaired');
		});
	});
});
