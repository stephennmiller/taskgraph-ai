/**
 * The TodoWrite hook hands Claude Code's todo list to `taskgraph log-todos`
 * on stdin (#953), and only starts the CLI while a task is in progress.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
	fakeCli,
	hookInput,
	projectWithTask,
	removeTempDirs,
	runHook,
	tempDir,
	todoWrite
} from './hook-helpers.js';

afterAll(removeTempDirs);

/** A fake CLI that writes its arguments, then its stdin, to `log` */
const recordingCli = (log: string) =>
	fakeCli(`printf '%s\\n' "$*" > '${log}'; cat >> '${log}'`);

describe('TodoWrite hook', () => {
	it('pipes the todo list to taskgraph log-todos for the project', () => {
		const dir = projectWithTask('tg-hook-todos-', 'in-progress');
		const log = path.join(tempDir('tg-hook-log-'), 'calls');
		const input = hookInput({
			tool_name: 'TodoWrite',
			tool_input: { todos: [{ content: 'a', status: 'completed' }] }
		});

		const result = runHook(todoWrite, dir, recordingCli(log), { input });

		expect(result.status).toBe(0);
		expect(result.stdout).toBe('');
		expect(fs.readFileSync(log, 'utf8')).toBe(
			`log-todos --project ${dir}\n${input}`
		);
	});

	it('does not start the CLI when no task is in progress', () => {
		const dir = projectWithTask('tg-hook-todos-', 'pending');
		const log = path.join(tempDir('tg-hook-log-'), 'calls');

		runHook(todoWrite, dir, recordingCli(log), { input: hookInput({}) });

		expect(fs.existsSync(log)).toBe(false);
	});

	it('succeeds quietly when the CLI fails, as one without log-todos does', () => {
		const dir = projectWithTask('tg-hook-todos-', 'in-progress');

		const result = runHook(todoWrite, dir, fakeCli('echo nope >&2; exit 1'), {
			input: hookInput({})
		});

		expect(result).toMatchObject({ status: 0, stdout: '', stderr: '' });
	});
});
