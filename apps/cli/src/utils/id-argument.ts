/**
 * @fileoverview `expand 3` and `expand --id=3` mean the same (#882): pick the
 * ID from the argument or the flag, refusing two different ones.
 */

import { terminalSafe } from '../ui/formatters/markdown-formatters.js';
import { printError } from './error-handler.js';

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
		printError(
			`Give the ID once: "${terminalSafe(arg)}" or --id=${terminalSafe(flag)}`,
			`Try \`taskgraph ${command} ${terminalSafe(flag)}\``
		);
		process.exit(1);
	}
	return flag ?? arg;
}
