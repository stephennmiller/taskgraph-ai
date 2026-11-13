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
 * @param what - What was given twice, and the flag that takes it
 */
export function rejectDifferentId(
	arg: string,
	flag: string,
	tryLine: string,
	what = { name: 'the ID', flag: '--id' }
): never {
	printError(
		`Give ${what.name} once: "${terminalSafe(arg)}" or ${what.flag}=${terminalSafe(flag)}`,
		`Try \`${tryLine}\``
	);
	process.exit(1);
}

/**
 * `move 3 7` and `move --from=3 --to=7` mean the same (#1149): pick the value
 * from the argument or its flag, refusing two different ones.
 * @param what - What the value is, and the flag that takes it
 * @param command - The command name, for the hint
 */
export function pickValue(
	arg: string | undefined,
	flag: string | undefined,
	what: { name: string; flag: string },
	command: string
): string | undefined {
	if (arg !== undefined && flag !== undefined && arg !== flag) {
		rejectDifferentId(
			arg,
			flag,
			`taskgraph ${command} ${what.flag}=${terminalSafe(flag)}`,
			what
		);
	}
	return flag ?? arg;
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
