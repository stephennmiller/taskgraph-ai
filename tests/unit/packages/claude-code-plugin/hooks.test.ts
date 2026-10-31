/**
 * The plugin's hooks are POSIX shell scripts in hooks/, which hooks.json runs
 * by name (a plugin validator rejects inline commands it can't read). The
 * plugin installs user-wide, so outside a TaskGraph
 * project they must print nothing; inside one they hand `taskgraph prime`
 * output to Claude, or say what to install.
 *
 * SessionStart also records when the session started, in
 * $TMPDIR/taskgraph-<uid>/session-<session_id> (a 0700 folder the user owns,
 * so other users on a shared /tmp can't plant or read it); the Stop hook
 * reads it to remind Claude, once per session, about an in-progress task
 * with no note since. Otherwise the Stop hook keeps Claude going once while
 * the task in progress has unchecked acceptance criteria, and the
 * UserPromptSubmit hook adds that task to each prompt.
 *
 * Lives here rather than beside the plugin because the plugin package ships
 * no TypeScript.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
	config,
	fakeCli,
	hookInput,
	markerDir,
	pluginDir,
	project,
	projectWithTask,
	removeTempDirs,
	runHook,
	sessionStart,
	stop,
	systemBin,
	tempDir
} from './hook-helpers.js';

afterAll(removeTempDirs);

describe('plugin hooks.json', () => {
	it('registers a SessionStart hook for every session source, a UserPromptSubmit hook and a Stop hook', () => {
		expect(Object.keys(config.hooks)).toEqual([
			'SessionStart',
			'UserPromptSubmit',
			'Stop'
		]);
		// No matcher: startup, resume, clear and compact all re-prime. That
		// covers compaction: a PreCompact hook's output never reaches Claude
		expect(config.hooks.SessionStart[0].matcher).toBeUndefined();
	});

	it('runs each hook script by name from the plugin folder', () => {
		const dir = project('tg-hook-command-');
		const bin = fakeCli('echo primed');

		const result = spawnSync(
			'/bin/sh',
			['-c', config.hooks.SessionStart[0].hooks[0].command],
			{
				cwd: dir,
				encoding: 'utf8',
				env: {
					PATH: `${bin}:${systemBin}`,
					CLAUDE_PROJECT_DIR: dir,
					CLAUDE_PLUGIN_ROOT: pluginDir
				}
			}
		);

		expect(result.stdout).toBe('primed\n');
		expect(config.hooks.Stop[0].hooks[0].command).toBe(
			'sh "${CLAUDE_PLUGIN_ROOT}/hooks/stop.sh"'
		);
		expect(config.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
			'sh "${CLAUDE_PLUGIN_ROOT}/hooks/prompt-submit.sh"'
		);
	});

	it('checks the scripts out with LF endings, even under core.autocrlf on Windows', () => {
		// A CR makes `exit 0` fail with status 2, which a Stop hook treats as "keep going"
		const result = spawnSync(
			'git',
			[
				'check-attr',
				'eol',
				'--',
				'hooks/session-start.sh',
				'hooks/stop.sh',
				'hooks/prompt-submit.sh'
			],
			{ cwd: pluginDir, encoding: 'utf8' }
		);

		expect(result.stdout).toBe(
			'hooks/session-start.sh: eol: lf\nhooks/stop.sh: eol: lf\nhooks/prompt-submit.sh: eol: lf\n'
		);
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

	it('asks for a note after compaction while a task is in progress', () => {
		const dir = projectWithTask('tg-hook-compact-', 'in-progress');
		const idle = projectWithTask('tg-hook-compact-idle-', 'pending');
		const bin = fakeCli('echo primed');
		const run = (d: string, source: string) =>
			runHook(sessionStart, d, bin, {
				input: hookInput({ source }),
				tmp: tempDir('tg-hook-tmp-')
			}).stdout;

		expect(run(dir, 'compact')).toBe(
			"primed\n\nThe conversation was just compacted. If a task is in progress, log what you did on it before compaction now, from the summary: taskgraph note <id> '<what you did or decided>'\n"
		);
		expect(run(dir, 'startup')).toBe('primed\n');
		expect(run(idle, 'compact')).toBe('primed\n');
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
