/**
 * @fileoverview The yes/no question every command asks the same way (#1146):
 * it defaults to no and is cleared once answered. "No" and Ctrl-C both print
 * one muted line; Ctrl-C then exits 130.
 */

import { theme } from '../ui/theme.js';

/**
 * Ask on a terminal; the caller checks there is one first.
 * @param question - Short enough that `? <question> (y/N)` fits 80 columns
 * @param cancelled - What "no" and Ctrl-C print, e.g. `Cancelled; nothing was deleted`
 * @returns Whether the answer was yes
 */
export async function confirm(
	question: string,
	cancelled: string
): Promise<boolean> {
	const { default: inquirer } = await import('inquirer');
	const ask = inquirer.createPromptModule({ clearPromptOnDone: true });
	const cancel = () => console.log(theme.muted(cancelled));
	try {
		const { yes } = await ask<{ yes: boolean }>([
			{ type: 'confirm', name: 'yes', message: question, default: false }
		]);
		if (!yes) cancel();
		return yes;
	} catch (error) {
		if ((error as Error)?.name !== 'ExitPromptError') throw error;
		cancel();
		process.exit(130);
	}
}
