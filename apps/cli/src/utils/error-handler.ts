/**
 * @fileoverview Centralized error handling utilities for CLI
 * Every CLI error prints the same two lines: what went wrong, then what to
 * do about it.
 *
 *   ✗ Task 99 not found
 *     Run taskgraph list to see task IDs
 */

import { stripTerminalControls } from '@tm/core';
import chalk from 'chalk';
import { theme } from '../ui/theme.js';

/**
 * Check if debug mode is enabled via environment variable
 * Only returns true when DEBUG is explicitly set to 'true' or '1'
 *
 * @returns True if debug mode is enabled
 */
export function isDebugMode(): boolean {
	return process.env.DEBUG === 'true' || process.env.DEBUG === '1';
}

/** What went wrong, and (optionally) the next thing to try */
export interface ErrorMessage {
	message: string;
	/** Commands inside `backticks` are highlighted */
	hint?: string;
}

/** Error codes that only say "something failed" and wrap a more useful cause */
const WRAPPER_CODES = new Set([
	'UNKNOWN_ERROR',
	'INTERNAL_ERROR',
	'STORAGE_ERROR'
]);

/** Hints for errors that carry a TaskGraphError code */
const HINTS_BY_CODE: Record<string, string> = {
	TASK_NOT_FOUND: 'Run `taskgraph list` to see task IDs',
	JSON_PARSE_ERROR:
		'Nothing was changed; fix the file or restore it from version control'
};

/**
 * Turn any thrown value into one message and an optional hint.
 * Walks past generic wrappers ("Failed to get task list") to the cause that
 * says what actually went wrong.
 */
export function describeError(error: any, hint?: string): ErrorMessage {
	let current = error;
	while (
		current?.cause &&
		typeof current.code === 'string' &&
		WRAPPER_CODES.has(current.code)
	) {
		current = current.cause;
	}

	const raw =
		typeof current?.getUserMessage === 'function'
			? current.getUserMessage()
			: typeof current?.getSanitizedDetails === 'function'
				? current.getSanitizedDetails().message
				: (current?.message ?? String(current));

	const message = cleanMessage(raw);
	// Older code can attach the fix to the error it throws
	const ownHint =
		typeof current?.hint === 'string' ? (current.hint as string) : undefined;
	return {
		message,
		hint: hint ?? ownHint ?? defaultHint(message, current?.code)
	};
}

/** "Subtask 3.9 not found": its parent is the place to look */
const MISSING_SUBTASK = /\bsubtask (\d+)\.\d+ not found\b/i;
/** "Task 9 not found", not "Tasks file not found" */
const MISSING_TASK = /\btask\b(?!\s+file).*\bnot found\b/i;
/** 'Tag "x" not found', 'Source tag "x" not found' */
const MISSING_TAG = /^(source |target )?tag\b.*\bnot found\b/i;
/** 'Tag "x" already exists', 'Target tag "x" already exists' */
const DUPLICATE_TAG = /^(source |target )?tag\b.*\balready exists\b/i;

/**
 * The next step for an error the caller gave no hint for: by code first, then
 * by the wording older code uses in plain Errors.
 */
function defaultHint(message: string, code?: string): string | undefined {
	if (code && HINTS_BY_CODE[code]) {
		return HINTS_BY_CODE[code];
	}
	// Before the task checks: a tag named "task-old" mentions "task"
	if (MISSING_TAG.test(message) || DUPLICATE_TAG.test(message)) {
		return 'Run `taskgraph tags` to see your tags';
	}
	const subtask = MISSING_SUBTASK.exec(message);
	if (subtask) {
		return `Run \`taskgraph show ${subtask[1]}\` to see its subtasks`;
	}
	if (MISSING_TASK.test(message)) {
		return HINTS_BY_CODE.TASK_NOT_FOUND;
	}
	return undefined;
}

/**
 * Strip the noise older code adds around a message and word the same failure
 * the same way everywhere: no leading "Error:" (the red mark already says
 * it), no trailing period, "Task 9" rather than "Parent task with ID 9", and
 * "not found" rather than "does not exist".
 */
function cleanMessage(message: string): string {
	// Messages can quote task text or a model's reply: no escape sequences
	const text = stripTerminalControls(message)
		.trim()
		.replace(/^(error:\s*)+/i, '')
		.replace(/\.$/, '')
		.replace(/\b(task|subtask) with ID "?([\d.]+)"?/gi, '$1 $2')
		.replace(/^(source |parent )+task\b/i, 'Task')
		.replace(/\bdoes not exist$/i, 'not found');
	return text;
}

/**
 * Render an error as two lines: a red mark with the message, then a dim hint
 * with any `command` in brand color so it stands out and reads as copyable.
 */
export function formatErrorMessage({ message, hint }: ErrorMessage): string {
	let output = `${chalk.red('✗')} ${message}`;
	if (hint) {
		const styled = hint
			.split(/`([^`]+)`/)
			.map((part, i) => (i % 2 === 1 ? theme.brand(part) : theme.muted(part)))
			.join('');
		output += `\n  ${styled}`;
	}
	return output;
}

/**
 * Restyle an error Commander raised while parsing arguments ("error: unknown
 * command 'shwo'\n(Did you mean show?)") into the same two lines as every
 * other error, turning Commander's suggestion into the hint.
 *
 * @param text - What Commander would have printed
 * @param commandPath - The subcommand that rejected its arguments ("tags use"),
 *   or undefined for the top-level program
 */
export function formatCommanderError(
	text: string,
	commandPath?: string
): string {
	const [first = '', ...rest] = text.trim().split('\n');
	const reason = first
		.replace(/^error:\s*/i, '')
		// "option '-s, --status <status>' argument missing" -> "--status needs a value"
		.replace(
			/^option '(?:-\w, )?(--[\w-]+)[^']*' argument missing$/i,
			'$1 needs a value'
		);
	const message = reason.charAt(0).toUpperCase() + reason.slice(1);
	const suggestion = /\(Did you mean (.+?)\?\)/.exec(rest.join(' '))?.[1];

	let hint: string | undefined;
	if (/^unknown command/i.test(reason)) {
		hint = suggestion
			? `Did you mean \`taskgraph ${suggestion}\`?`
			: 'Run `taskgraph --help` to see all commands';
	} else if (suggestion) {
		hint = `Did you mean \`${suggestion}\`?`;
	} else if (commandPath) {
		hint = `Run \`taskgraph ${commandPath} --help\` to see its options`;
	}

	return formatErrorMessage({ message: cleanMessage(message), hint });
}

/**
 * Print an error message (and hint) to stderr, preceded by a blank line so
 * it separates from whatever the command printed before failing.
 */
export function printError(message: string, hint?: string): void {
	console.error(
		`\n${formatErrorMessage({ message: cleanMessage(message), hint })}`
	);
}

/**
 * Display an error to the user with optional stack trace in debug mode
 * Handles both TaskGraphError instances and regular errors
 *
 * @param error - The error to display
 * @param options - Display options
 */
export function displayError(
	error: any,
	options: {
		/** Skip exit, useful when caller wants to handle exit */
		skipExit?: boolean;
		/** Force show stack trace regardless of debug mode */
		forceStack?: boolean;
		/** Next step to suggest, overriding the default for the error's code */
		hint?: string;
	} = {}
): void {
	console.error(`\n${formatErrorMessage(describeError(error, options.hint))}`);

	// Show stack trace in debug mode or if forced
	if ((isDebugMode() || options.forceStack) && error?.stack) {
		console.error(theme.muted('\nStack trace:'));
		console.error(theme.muted(error.stack));
	}

	// Exit if not skipped
	if (!options.skipExit) {
		process.exit(1);
	}
}
