/**
 * The plugin's Stop hook: once per session it reminds Claude to log a note on
 * the task in progress (from the session start time session-start.sh
 * records); otherwise it keeps Claude going once while that task has
 * unchecked acceptance criteria. Never twice in a row.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	fakeCli,
	hookInput,
	markerDir,
	project,
	projectWithTask,
	removeTempDirs,
	runHook,
	sessionStart,
	stop,
	tempDir
} from './hook-helpers.js';

afterAll(removeTempDirs);

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
			'case "$*" in *--unmet-criteria*) exit 0 ;; esac; echo "args: $*"; echo "Task 3 is still in progress with no note from this session."'
		);

	/** A CLI that reports unchecked criteria, and no unnoted task */
	const gatingCli = () =>
		fakeCli(
			'case "$*" in *--unmet-criteria*) echo "args: $*"; echo "Task 3 is still in progress with unchecked acceptance criteria:" ;; esac'
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

	it('keeps Claude going once while the task in progress has unchecked criteria', () => {
		const dir = projectWithTask('tg-gate-', 'in-progress');
		const bin = gatingCli();

		const first = runHook(stop, dir, bin, {
			input: hookInput({ stop_hook_active: false })
		});
		const again = runHook(stop, dir, bin, {
			input: hookInput({ stop_hook_active: true })
		});

		expect(first.status).toBe(2);
		expect(first.stderr).toBe(
			`args: prime --project ${dir} --unmet-criteria\nTask 3 is still in progress with unchecked acceptance criteria:\n`
		);
		expect(again.status).toBe(0);
		expect(again.stderr).toBe('');
	});

	it('gives the note reminder first, then the criteria on a later stop', () => {
		const { dir, tmp } = session('2026-10-23T09:00:00Z');
		const bin = fakeCli(
			'case "$*" in *--unmet-criteria*) echo "criteria unchecked" ;; *) echo "no note" ;; esac'
		);
		const input = hookInput({ stop_hook_active: false });

		const first = runHook(stop, dir, bin, { input, tmp });
		const later = runHook(stop, dir, bin, { input, tmp });

		expect([first.status, first.stderr]).toEqual([2, 'no note\n']);
		expect([later.status, later.stderr]).toEqual([2, 'criteria unchecked\n']);
	});

	it('lets Claude stop when the criteria are checked or the CLI predates --unmet-criteria', () => {
		const dir = projectWithTask('tg-gate-met-', 'in-progress');
		const old = fakeCli(
			`echo "error: unknown option '--unmet-criteria'" >&2; exit 1`
		);

		for (const bin of [fakeCli('exit 0'), old]) {
			const result = runHook(stop, dir, bin, { input: hookInput({}) });
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe('');
		}
	});

	it('does not start the CLI when tasks.json has no task in progress', () => {
		const dir = projectWithTask('tg-gate-idle-', 'pending');

		const result = runHook(stop, dir, gatingCli(), { input: hookInput({}) });

		expect(result.status).toBe(0);
		expect(result.stderr).toBe('');
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
