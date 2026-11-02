/**
 * @fileoverview `expand 3` and `expand --id=3` mean the same (#926): pick the
 * ID from the argument or the flag, refusing two different ones.
 */

import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { printError } from './error-handler.js';

/** A single task id (`3` or `3.2`), not a prompt word and not a comma list */
export function isTaskIdToken(value: string): boolean {
	return /^\d+(\.\d+)?$/.test(value);
}

/**
 * Exit 1 when the positional ID and `--id` name different tasks.
 * @param arg - The ID typed as an argument
 * @param flag - The `--id` value
 * @param tryLine - The command to suggest, without the surrounding backticks
 */
export function rejectDifferentId(
	arg: string,
	flag: string,
	tryLine: string
): never {
	printError(
		`Give the ID once: "${terminalSafe(arg)}" or --id=${terminalSafe(flag)}`,
		`Try \`${tryLine}\``
	);
	process.exit(1);
}

/**
 * @param arg - The `[id]` argument
 * @param flag - The `--id` value
 * @param command - The command name, for the hint
 */
export function pickId(
	arg: string | undefined,
	flag: string | undefined,
	command: string
): string | undefined {
	if (arg !== undefined && flag !== undefined && arg !== flag) {
		rejectDifferentId(arg, flag, `taskgraph ${command} ${terminalSafe(flag)}`);
	}
	return flag ?? arg;
}
