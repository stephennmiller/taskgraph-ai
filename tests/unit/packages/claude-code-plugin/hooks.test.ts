/**
 * The plugin's hooks are shell one-liners in hooks/hooks.json (the plugin
 * ships no code). The plugin installs user-wide, so outside a TaskGraph
 * project they must print nothing; inside one they hand `taskgraph prime`
 * output to Claude, or say what to install.
 *
 * SessionStart also records when the session started, in
 * $TMPDIR/taskgraph-<uid>/session-<session_id> (a 0700 folder the user owns,
 * so other users on a shared /tmp can't plant or read it); the Stop hook
 * reads it to remind Claude, once per session, about an in-progress task
 * with no note since.
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
const stop: string = config.hooks.Stop[0].hooks[0].command;

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

/** Only the system tools the hooks use, so a global taskgraph stays off PATH */
const systemBin = (() => {
	const bin = tempDir('tg-hook-sys-');
	for (const tool of ['date', 'id', 'mkdir']) {
		const found = ['/usr/bin', '/bin']
			.map((dir) => path.join(dir, tool))
			.find((file) => fs.existsSync(file));
		if (found) fs.symlinkSync(found, path.join(bin, tool));
	}
	return bin;
})();

/** The private folder the hooks keep session markers in, under `tmp` */
const markerDir = (tmp: string) =>
	path.join(tmp, `taskgraph-${process.getuid?.() ?? ''}`);

/** A TaskGraph project, i.e. one with the config.json `init` writes */
function project(prefix: string): string {
	const dir = tempDir(prefix);
	fs.mkdirSync(path.join(dir, '.taskgraph'));
	fs.writeFileSync(path.join(dir, '.taskgraph/config.json'), '{}');
	return dir;
}

interface HookRun {
	/** The JSON Claude Code sends on stdin */
	input?: string;
	/** Where the session marker goes */
	tmp?: string;
	/** Run with this shell instead of bash */
	shell?: string;
	/** Extra environment variables */
	env?: Record<string, string>;
}

function runHook(
	command: string,
	projectDir: string,
	binDir: string,
	options: HookRun = {}
) {
	return spawnSync(options.shell ?? '/bin/bash', ['-c', command], {
		cwd: projectDir,
		encoding: 'utf8',
		input: options.input ?? '',
		env: {
			PATH: `${binDir}:${systemBin}`,
			CLAUDE_PROJECT_DIR: projectDir,
			...(options.tmp ? { TMPDIR: options.tmp } : {}),
			...options.env
		}
	});
}

/** Compact JSON, as Claude Code sends it */
const hookInput = (fields: Record<string, unknown>) =>
	JSON.stringify({ session_id: 'abc-123', cwd: '/x', ...fields });

afterAll(() => {
	for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('plugin hooks.json', () => {
	it('registers a SessionStart hook for every session source, and a Stop hook', () => {
		expect(Object.keys(config.hooks)).toEqual(['SessionStart', 'Stop']);
		// No matcher: startup, resume, clear and compact all re-prime. That
		// covers compaction: a PreCompact hook's output never reaches Claude
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
			`TaskGraph tracks work in this project · args: prime --project ${dir} --plugin-root \nskip=1\n`
		);
	});

	it('primes the project TASKGRAPH_PROJECT_ROOT names, as in a loop --parallel worktree', () => {
		const main = project('tg-hook-main-');
		const worktree = tempDir('tg-hook-worktree-');
		const bin = fakeCli('echo "args: $*"');

		const result = runHook(sessionStart, worktree, bin, {
			env: { TASKGRAPH_PROJECT_ROOT: main }
		});

		expect(result.stdout).toBe(
			`args: prime --project ${main} --plugin-root \n`
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

	it('passes the plugin folder so prime can check the CLI version', () => {
		const dir = project('tg-hook-plugin-root-');
		const bin = fakeCli('echo "args: $*"');

		const result = runHook(sessionStart, dir, bin, {
			env: { CLAUDE_PLUGIN_ROOT: '/plugins/taskgraph/0.58.0' }
		});

		expect(result.stdout).toBe(
			`args: prime --project ${dir} --plugin-root /plugins/taskgraph/0.58.0\n`
		);
	});

	it('passes a plugin folder with spaces and shell characters as one argument', () => {
		const dir = project('tg-hook-plugin-root-space-');
		const bin = fakeCli('printf \'[%s]\' "$@"; echo');
		const pluginRoot = '/Users/Jane Doe/plugins/$(touch pwned) `x`;';

		const result = runHook(sessionStart, dir, bin, {
			env: { CLAUDE_PLUGIN_ROOT: pluginRoot }
		});

		expect(result.stdout).toBe(
			`[prime][--project][${dir}][--plugin-root][${pluginRoot}]\n`
		);
	});

	it('says to update when the CLI predates the plugin version check', () => {
		const dir = project('tg-hook-noplugincheck-');
		const bin = fakeCli(
			`echo "✗ Unknown option '--plugin-root'" >&2; echo "  Run taskgraph prime --help to see its options" >&2; exit 1`
		);

		const result = runHook(sessionStart, dir, bin, {
			env: { CLAUDE_PLUGIN_ROOT: '/plugins/taskgraph' }
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toBe(
			'This project tracks work in TaskGraph, but the installed taskgraph CLI is too old for the plugin. Ask the user to run: npm install -g taskgraph-ai@latest\n'
		);
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

	it('records when the session started, and keeps it across compaction', () => {
		const dir = project('tg-hook-marker-');
		const tmp = tempDir('tg-hook-tmp-');
		const bin = fakeCli('echo primed');
		const marker = path.join(markerDir(tmp), 'session-abc-123');

		runHook(sessionStart, dir, bin, {
			input: hookInput({ source: 'startup' }),
			tmp
		});
		const started = fs.readFileSync(marker, 'utf8');
		fs.writeFileSync(marker, '2026-10-23T09:00:00Z\n');
		runHook(sessionStart, dir, bin, {
			input: hookInput({ source: 'compact' }),
			tmp
		});

		expect(started).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ\n$/);
		expect(fs.statSync(markerDir(tmp)).mode & 0o777).toBe(0o700);
		expect(fs.readFileSync(marker, 'utf8')).toBe('2026-10-23T09:00:00Z\n');
	});

	it('does not record a session ID that could leave the temp folder', () => {
		const dir = project('tg-hook-badsid-');
		const tmp = tempDir('tg-hook-tmp-');
		const bin = fakeCli('echo primed');

		const result = runHook(sessionStart, dir, bin, {
			input: JSON.stringify({ session_id: '../../etc/x', source: 'startup' }),
			tmp
		});

		expect(result.stdout).toBe('primed\n');
		expect(fs.readdirSync(tmp)).toEqual([]);
	});

	it('does not write through a marker folder that is a symlink', () => {
		const dir = project('tg-hook-symlink-');
		const tmp = tempDir('tg-hook-tmp-');
		const target = tempDir('tg-hook-target-');
		fs.symlinkSync(target, markerDir(tmp));

		const result = runHook(sessionStart, dir, fakeCli('echo primed'), {
			input: hookInput({ source: 'startup' }),
			tmp
		});

		expect(result.stdout).toBe('primed\n');
		expect(fs.readdirSync(target)).toEqual([]);
	});
});

describe('plugin Stop hook', () => {
	/** A project whose session started at the given time */
	function session(started: string, extra = '') {
		const dir = project('tg-stop-');
		const tmp = tempDir('tg-stop-tmp-');
		fs.mkdirSync(markerDir(tmp), { mode: 0o700 });
		fs.writeFileSync(
			path.join(markerDir(tmp), 'session-abc-123'),
			`${started}\n${extra}`
		);
		return { dir, tmp };
	}

	const remindingCli = () =>
		fakeCli(
			'echo "args: $*"; echo "Task 3 is still in progress with no note from this session."'
		);

	it('reminds Claude once, through stderr and exit 2, with the session start time', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const bin = remindingCli();
		const input = hookInput({ stop_hook_active: false });

		const first = runHook(stop, dir, bin, { input, tmp });
		const second = runHook(stop, dir, bin, { input, tmp });

		expect(first.status).toBe(2);
		expect(first.stdout).toBe('');
		expect(first.stderr).toBe(
			`args: prime --project ${dir} --unnoted-since 2026-10-23T09:00:00Z\nTask 3 is still in progress with no note from this session.\n`
		);
		expect(second.status).toBe(0);
		expect(second.stderr).toBe('');
	});

	it('checks the project TASKGRAPH_PROJECT_ROOT names for unnoted tasks', () => {
		const { dir: main, tmp } = session('2026-10-23T09:00:00Z');
		const worktree = tempDir('tg-hook-stop-worktree-');
		const bin = remindingCli();

		const result = runHook(stop, worktree, bin, {
			input: hookInput({ stop_hook_active: false }),
			tmp,
			env: { TASKGRAPH_PROJECT_ROOT: main }
		});

		expect(result.status).toBe(2);
		expect(result.stderr).toContain(
			`args: prime --project ${main} --unnoted-since 2026-10-23T09:00:00Z`
		);
	});

	it('stays quiet when every in-progress task has a note this session', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const bin = fakeCli('exit 0');

		const result = runHook(stop, dir, bin, { input: hookInput({}), tmp });

		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toBe('');
	});

	it('never blocks a stop that a stop hook already continued', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');

		const result = runHook(stop, dir, remindingCli(), {
			input: hookInput({ stop_hook_active: true }),
			tmp
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
	});

	it('stays quiet without a recorded session start or a usable session ID', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const bin = remindingCli();
		const other = runHook(stop, dir, bin, {
			input: JSON.stringify({ session_id: 'other-session' }),
			tmp
		});
		const traversal = runHook(stop, dir, bin, {
			input: JSON.stringify({ session_id: '../session-abc-123' }),
			tmp
		});
		const none = runHook(stop, dir, bin, { input: '', tmp });

		for (const result of [other, traversal, none]) {
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe('');
		}
	});

	it('ignores a marker folder that is a symlink, and never appends through it', () => {
		const dir = project('tg-stop-symlink-');
		const tmp = tempDir('tg-stop-tmp-');
		const target = tempDir('tg-stop-target-');
		const victim = path.join(target, 'session-abc-123');
		fs.writeFileSync(victim, '2026-10-23T09:00:00Z\n');
		fs.symlinkSync(target, markerDir(tmp));

		const result = runHook(stop, dir, remindingCli(), {
			input: hookInput({}),
			tmp
		});

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
		expect(fs.readFileSync(victim, 'utf8')).toBe('2026-10-23T09:00:00Z\n');
	});

	// Root can write a read-only file, so this only runs as a normal user
	it.skipIf(process.getuid?.() === 0)(
		'does not block when it cannot record that the reminder was shown',
		() => {
			const { dir, tmp } = session('2026-10-23T09:00:00Z');
			fs.chmodSync(path.join(markerDir(tmp), 'session-abc-123'), 0o400);

			const result = runHook(stop, dir, remindingCli(), {
				input: hookInput({}),
				tmp
			});

			expect(result.status).toBe(0);
			expect(result.stderr).toBe('');
		}
	);

	it('ignores a session_id key quoted inside another field', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const input = JSON.stringify({
			last_assistant_message: '"session_id":"abc-123"',
			session_id: 'zzz'
		});

		const result = runHook(stop, dir, remindingCli(), { input, tmp });

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
	});

	it('stays quiet when the CLI is missing, fails or predates --unnoted-since', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const old = fakeCli(
			`echo "error: unknown option '--unnoted-since'" >&2; exit 1`
		);
		const empty = tempDir('tg-stop-empty-bin-');
		const input = hookInput({});

		for (const bin of [old, empty]) {
			const result = runHook(stop, dir, bin, { input, tmp });
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe('');
		}
	});

	it('prints nothing outside a TaskGraph project', () => {
		const dir = tempDir('tg-stop-none-');

		const result = runHook(stop, dir, remindingCli(), {
			input: hookInput({})
		});

		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toBe('');
	});

	it('passes task text through as data, never as shell code', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const pwned = path.join(tmp, 'pwned');
		const bin = fakeCli(
			`printf '%s\\n' 'Task "$(touch ${pwned})" \`touch ${pwned}\`; $HOME'`
		);

		const result = runHook(stop, dir, bin, { input: hookInput({}), tmp });

		expect(result.status).toBe(2);
		expect(result.stderr).toContain(`$(touch ${pwned})`);
		expect(fs.existsSync(pwned)).toBe(false);
	});

	it.runIf(fs.existsSync('/bin/dash'))(
		'works under dash, a plain POSIX sh',
		() => {
			const { dir, tmp } = session('2026-10-23T09:00:00Z');
			const bin = remindingCli();

			const start = runHook(
				sessionStart,
				project('tg-dash-'),
				fakeCli('echo primed'),
				{
					input: hookInput({ source: 'startup' }),
					tmp: tempDir('tg-dash-tmp-'),
					shell: '/bin/dash'
				}
			);
			const result = runHook(stop, dir, bin, {
				input: hookInput({}),
				tmp,
				shell: '/bin/dash'
			});

			expect(start.stdout).toBe('primed\n');
			expect(result.status).toBe(2);
			expect(result.stderr).toContain('Task 3 is still in progress');
		}
	);
});
