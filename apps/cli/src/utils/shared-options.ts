/**
 * @fileoverview The options most commands take, declared once so every
 * command's help says the same thing (#1149)
 */

import { Option } from 'commander';

/** `-p, --project <path>`: the project to work on, read with `getProjectRoot` */
export const projectOption = (): Option =>
	new Option(
		'-p, --project <path>',
		'Project folder (default: found from the current folder)'
	);

/**
 * `--tag <tag>`: the tag to work in.
 * @param flags - `-t, --tag <tag>` on the commands that have the short form
 */
export const tagOption = (flags = '--tag <tag>'): Option =>
	new Option(flags, 'Tag to work in (default: the current tag)');
