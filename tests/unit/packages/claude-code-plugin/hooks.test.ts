/**
 * The plugin's hooks are shell one-liners in hooks/hooks.json (the plugin
 * ships no code). The plugin installs user-wide, so outside a TaskGraph
 * project they must print nothing; inside one they hand `taskgraph prime`
 * output to Claude, or say what to install.
 *
 * Lives here rather than beside the plugin because the plugin package is
 * markdown and JSON only.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../..'
);
const hooksFile = path.join(
	rootDir,
	'packages/claude-code-plugin/hooks/hooks.json'
);
const config = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));

const sessionStart: string = config.hooks.SessionStart[0].hooks[0].command;

const tempDirs: string[] = [];
const tempDir = (prefix: string) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
};

/** A bin directory holding a fake `taskgraph` with the given script body */
function fakeCli(body: string): string {
	const bin = tempDir('tg-hook-bin-');
	const file = path.join(bin, 'taskgraph');
	fs.writeFileSync(file, `#!/bin/sh\n${body}\n`);
	fs.chmodSync(file, 0o755);
	return bin;
}

/** A TaskGraph project, i.e. one with the config.json `init` writes */
function project(prefix: string): string {
	const dir = tempDir(prefix);
	fs.mkdirSync(path.join(dir, '.taskgraph'));
	fs.writeFileSync(path.join(dir, '.taskgraph/config.json'), '{}');
	return dir;
}

function runHook(command: string, projectDir: string, binDir: string) {
	return spawnSync('/bin/bash', ['-c', command], {
		cwd: projectDir,
		encoding: 'utf8',
		env: { PATH: binDir, CLAUDE_PROJECT_DIR: projectDir }
	});
}

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('plugin hooks.json', () => {
	it('registers only a SessionStart hook, for every session source', () => {
		expect(Object.keys(config.hooks)).toEqual(['SessionStart']);
		// No matcher: startup, resume, clear and compact all re-prime
		expect(config.hooks.SessionStart[0].matcher).toBeUndefined();
	});

	it('prints nothing and succeeds outside a TaskGraph project', () => {
		const dir = tempDir('tg-hook-none-');
		const bin = fakeCli('echo "should not run"');

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
		expect(result.stderr).toBe('');
	});

	it('prints taskgraph prime output in a TaskGraph project', () => {
		const dir = project('tg-hook-project-');
		const bin = fakeCli(
			'echo "TaskGraph tracks work in this project · args: $*"; echo "skip=$TASKGRAPH_SKIP_AUTO_UPDATE"'
		);

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe(
			`TaskGraph tracks work in this project · args: prime --project ${dir}\nskip=1\n`
		);
	});

	it('keeps warnings prime writes to stderr out of the context when it succeeds', () => {
		const dir = project('tg-hook-warn-');
		const bin = fakeCli(
			'echo "⚠ No .taskgraph/config.json; using default settings" >&2; echo "TaskGraph tracks work in this project"'
		);

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe('TaskGraph tracks work in this project\n');
	});

	it('prints nothing for an empty .taskgraph folder, which is not a project', () => {
		const dir = tempDir('tg-hook-empty-');
		fs.mkdirSync(path.join(dir, '.taskgraph'));
		const bin = fakeCli('echo "should not run"');

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
	});

	it('runs in a project that has tasks.json but no config.json', () => {
		const dir = tempDir('tg-hook-tasks-only-');
		fs.mkdirSync(path.join(dir, '.taskgraph/tasks'), { recursive: true });
		fs.writeFileSync(path.join(dir, '.taskgraph/tasks/tasks.json'), '{}');
		const bin = fakeCli('echo "primed"');

		const result = runHook(sessionStart, dir, bin);

		expect(result.stdout).toBe('primed\n');
	});

	it('says how to install the CLI when it is missing', () => {
		const dir = project('tg-hook-nocli-');
		const emptyBin = tempDir('tg-hook-empty-bin-');

		const result = runHook(sessionStart, dir, emptyBin);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('npm install -g taskgraph-ai');
	});

	it('says to update when the CLI has no prime command', () => {
		const dir = project('tg-hook-oldcli-');
		const bin = fakeCli(`echo "✗ Unknown command 'prime'" >&2; exit 1`);

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toContain('too old');
		expect(result.stdout).toContain('npm install -g taskgraph-ai@latest');
		expect(result.stdout).not.toContain('Unknown command');
	});

	it('passes any other prime error on to Claude', () => {
		const dir = project('tg-hook-broken-');
		const bin = fakeCli('echo "✗ tasks.json is not valid JSON" >&2; exit 1');

		const result = runHook(sessionStart, dir, bin);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe(
			'This project tracks work in TaskGraph, but taskgraph prime failed:\n✗ tasks.json is not valid JSON\n'
		);
	});
});
