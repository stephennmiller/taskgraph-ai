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

/** `-t, --tag <tag>`: the tag to work in */
export const tagOption = (): Option =>
	new Option('-t, --tag <tag>', 'Tag to work in (default: the current tag)');
