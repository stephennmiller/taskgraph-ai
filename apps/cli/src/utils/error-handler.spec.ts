import { TaskGraphError } from '@tm/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	describeError,
	displayError,
	formatCommanderError,
	formatErrorMessage,
	printError
} from './error-handler.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('describeError', () => {
	it('uses the message of a plain error', () => {
		expect(describeError(new Error('disk is full'))).toEqual({
			message: 'disk is full',
			hint: undefined
		});
	});

	it('drops escape sequences quoted from task text or a model reply', () => {
		expect(
			describeError(new Error('Task "Fix\x1b[2J\x1b]0;pwned\x07 login" failed'))
				.message
		).toBe('Task "Fix login" failed');
	});

	it('drops a leading "Error:" and a trailing period', () => {
		expect(describeError(new Error('Error: Task 9 not found.')).message).toBe(
			'Task 9 not found'
		);
	});

	it('words the same failure the same way whatever code raised it', () => {
		const message = (text: string) => describeError(new Error(text)).message;

		expect(message('Task with ID 9 not found')).toBe('Task 9 not found');
		expect(message('Parent task with ID 9 not found')).toBe('Task 9 not found');
		expect(message('Source task with ID 9 not found')).toBe('Task 9 not found');
		expect(message('Tag "x" does not exist')).toBe('Tag "x" not found');
		expect(message('nope.md not found')).toBe('nope.md not found');
	});

	it('looks past generic wrappers to the cause that says what went wrong', () => {
		const cause = new TaskGraphError(
			'Invalid JSON in /p/tasks.json',
			'JSON_PARSE_ERROR',
			{ userMessage: "tasks.json isn't valid JSON (line 2, column 1)" }
		);
		const wrapper = new TaskGraphError(
			'Failed to get task list',
			'INTERNAL_ERROR',
			{},
			cause
		);

		const { message, hint } = describeError(wrapper);

		expect(message).toBe("tasks.json isn't valid JSON (line 2, column 1)");
		expect(hint).toMatch(/version control/);
	});

	it('suggests listing tasks when a task is missing', () => {
		const error = new TaskGraphError('Task 9 not found', 'TASK_NOT_FOUND');

		expect(describeError(error).hint).toBe(
			'Run `taskgraph list` to see task IDs'
		);
	});

	it('recognizes the not-found wording of plain errors', () => {
		expect(describeError(new Error('Task with ID 9 not found.')).hint).toBe(
			'Run `taskgraph list` to see task IDs'
		);
		expect(
			describeError(new Error('Tasks file not found at path: x')).hint
		).toBeUndefined();
	});

	it("points a missing subtask at its parent's subtasks", () => {
		expect(describeError(new Error('Subtask 3.9 not found')).hint).toBe(
			'Run `taskgraph show 3` to see its subtasks'
		);
	});

	it('suggests listing tags when a tag is missing', () => {
		expect(describeError(new Error('Tag "nope" does not exist')).hint).toBe(
			'Run `taskgraph tags` to see your tags'
		);
	});

	it('suggests listing tags for source, target and duplicate tag errors', () => {
		for (const message of [
			'Source tag "nope" does not exist',
			'Target tag "backup" already exists',
			'Tag "feature-auth" already exists',
			// "task" in a tag name isn't a missing task
			'Tag "task-old" not found',
			'Source tag "task-old" does not exist'
		]) {
			expect(describeError(new Error(message)).hint).toBe(
				'Run `taskgraph tags` to see your tags'
			);
		}
	});

	it('uses a hint attached to the thrown error', () => {
		const error = Object.assign(new Error('Needs confirmation'), {
			hint: 'Pass `--yes`'
		});
		expect(describeError(error).hint).toBe('Pass `--yes`');
		expect(describeError(error, 'Caller wins').hint).toBe('Caller wins');
	});

	it('lets the caller supply the hint', () => {
		expect(describeError(new Error('nope'), 'Try again').hint).toBe(
			'Try again'
		);
	});

	it('reads the sanitized message of objects shaped like TaskGraph errors', () => {
		const error = {
			getSanitizedDetails: () => ({ message: 'Task 7 was not found' })
		};

		expect(describeError(error).message).toBe('Task 7 was not found');
	});
});

describe('formatErrorMessage', () => {
	it('prints the message after a cross mark', () => {
		expect(plain(formatErrorMessage({ message: 'Task 9 not found' }))).toBe(
			'✗ Task 9 not found'
		);
	});

	it('puts the hint on an indented second line without the backticks', () => {
		const text = formatErrorMessage({
			message: 'Task 9 not found',
			hint: 'Run `taskgraph list` to see task IDs'
		});

		expect(plain(text)).toBe(
			'✗ Task 9 not found\n  Run taskgraph list to see task IDs'
		);
	});
});

describe('formatCommanderError', () => {
	it('says -p means --project (#882)', () => {
		const text = formatCommanderError("error: unknown option '-p'", 'add-task');

		expect(plain(text)).toBe(
			"✗ Unknown option '-p'\n  -p means --project; write --prompt or --parent in full"
		);
	});

	it('turns Commander suggestions for commands into a runnable hint', () => {
		const text = formatCommanderError(
			"error: unknown command 'shwo'\n(Did you mean show?)\n"
		);

		expect(plain(text)).toBe(
			"✗ Unknown command 'shwo'\n  Did you mean taskgraph show?"
		);
	});

	it.each([
		['start', 'taskgraph loop -n 1 --id 3'],
		['autopilot', 'taskgraph loop -n 1 --id 3 --prompt tdd']
	])('says `%s <id>` was removed and points at loop', (name, replacement) => {
		const text = formatCommanderError(
			`error: unknown command '${name}'\n(Did you mean status?)`,
			undefined,
			[name, '3']
		);

		expect(plain(text)).toBe(
			`✗ Command '${name}' was removed\n  Run ${replacement} instead`
		);
	});

	it('strips escape sequences from the echoed ID of a removed command', () => {
		const text = formatCommanderError(
			"error: unknown command 'start'",
			undefined,
			['start', '3\x1b]0;pwned\x07\x1b[2J']
		);

		expect(text).not.toContain('\x1b]0');
		expect(plain(text)).toBe(
			"✗ Command 'start' was removed\n  Run taskgraph loop -n 1 --id 3 instead"
		);
	});

	it('uses a placeholder when a removed command has no ID', () => {
		expect(
			plain(
				formatCommanderError("error: unknown command 'start'", undefined, [
					'start'
				])
			)
		).toBe(
			"✗ Command 'start' was removed\n  Run taskgraph loop -n 1 --id <id> instead"
		);
	});

	it.each([
		[['start', '--id', '3'], '3'],
		[['start', '-i', '3'], '3'],
		[['start', '--id=3'], '3'],
		[['start', '-v', '3'], '<id>'],
		[['start', '--id'], '<id>']
	])('takes the ID of a removed command from %j', (args, id) => {
		expect(
			plain(
				formatCommanderError("error: unknown command 'start'", undefined, args)
			)
		).toBe(
			`✗ Command 'start' was removed\n  Run taskgraph loop -n 1 --id ${id} instead`
		);
	});

	it('keeps the nearest-name hint for other unknown commands', () => {
		expect(
			plain(
				formatCommanderError(
					"error: unknown command 'shwo'\n(Did you mean show?)",
					undefined,
					['shwo', '3']
				)
			)
		).toBe("✗ Unknown command 'shwo'\n  Did you mean taskgraph show?");
	});

	it('points to the command list when there is no suggestion', () => {
		expect(plain(formatCommanderError("error: unknown command 'zzz'"))).toBe(
			"✗ Unknown command 'zzz'\n  Run taskgraph --help to see all commands"
		);
	});

	it("points to the subcommand's help for option errors", () => {
		const text = formatCommanderError(
			"error: option '-s, --status <status>' argument missing",
			'list'
		);

		expect(plain(text)).toBe(
			'✗ --status needs a value\n  Run taskgraph list --help to see its options'
		);
	});
});

describe('printError and displayError', () => {
	let output: string[];

	beforeEach(() => {
		output = [];
		vi.spyOn(console, 'error').mockImplementation((line?: unknown) => {
			output.push(String(line));
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('writes to stderr with no blank line before the mark (#881)', () => {
		printError('Tag "x" not found', 'Run `taskgraph tags` to see your tags');
		displayError(new Error('boom'), { skipExit: true });

		expect(plain(output.join('\n'))).toBe(
			'✗ Tag "x" not found\n  Run taskgraph tags to see your tags\n✗ boom'
		);
	});

	it('shows the stack only when asked', () => {
		const error = new Error('boom');

		displayError(error, { skipExit: true });
		expect(output.join('\n')).not.toContain('Stack trace');

		output.length = 0;
		displayError(error, { skipExit: true, forceStack: true });
		expect(output.join('\n')).toContain('Stack trace');
	});

	it('exits with code 1 unless told to skip', () => {
		const exit = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => undefined) as never);

		displayError(new Error('fatal'));

		expect(exit).toHaveBeenCalledWith(1);
	});
});
