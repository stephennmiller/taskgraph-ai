/**
 * The plugin's UserPromptSubmit hook: adds the task in progress and its
 * unchecked criteria to each prompt, and nothing (without starting the CLI)
 * when no task is in progress.
 */

import fs from 'node:fs';
import {
	fakeCli,
	hookInput,
	project,
	projectWithTask,
	promptSubmit,
	removeTempDirs,
	runHook,
	tempDir
} from './hook-helpers.js';

afterAll(removeTempDirs);

describe('plugin UserPromptSubmit hook', () => {
	const currentCli = () =>
		fakeCli('echo "args: $*"; echo "TaskGraph task in progress:"');

	it('adds the task in progress to the prompt', () => {
		const dir = projectWithTask('tg-prompt-', 'in-progress');

		const result = runHook(promptSubmit, dir, currentCli(), {
			input: hookInput({ prompt: 'go on' })
		});

		expect(result.status).toBe(0);
		expect(result.stdout).toBe(
			`args: prime --project ${dir} --current\nTaskGraph task in progress:\n`
		);
	});

	it('prints nothing, without starting the CLI, when no task is in progress', () => {
		const dir = projectWithTask('tg-prompt-idle-', 'done');

		const result = runHook(promptSubmit, dir, currentCli());

		expect(result.status).toBe(0);
		expect(result.stdout + result.stderr).toBe('');
	});

	it('prints nothing outside a project, or when the CLI is missing or too old', () => {
		const outside = tempDir('tg-prompt-none-');
		const dir = projectWithTask('tg-prompt-old-', 'in-progress');
		const old = fakeCli(`echo "error: unknown option '--current'" >&2; exit 1`);

		const results = [
			runHook(promptSubmit, outside, currentCli()),
			runHook(promptSubmit, dir, old),
			runHook(promptSubmit, dir, tempDir('tg-prompt-empty-bin-'))
		];

		for (const result of results) {
			expect(result.status).toBe(0);
			expect(result.stdout + result.stderr).toBe('');
		}
	});

	it.runIf(fs.existsSync('/bin/dash'))('works under dash', () => {
		const dir = projectWithTask('tg-prompt-dash-', 'in-progress');

		const result = runHook(promptSubmit, dir, currentCli(), {
			shell: '/bin/dash'
		});

		expect(result.stdout).toContain('TaskGraph task in progress:');
	});
});
