/**
 * @fileoverview The `tm` shell alias init adds to the user's shell startup
 * file: only with `init --aliases` or a Yes to init's question, because the
 * file is outside the project
 */

import fs from 'node:fs';
import path from 'node:path';
import { getLogger } from '../../common/logger/index.js';

/** The alias init adds to the shell config */
export const ALIAS_LINE = "alias tm='taskgraph'";

const homeDir = (): string | undefined =>
	process.env.HOME || process.env.USERPROFILE;

/**
 * Shell startup files init may append the `tm` alias to, so the summary can
 * say which one changed
 */
export function shellConfigFiles(): string[] {
	const home = homeDir();
	if (!home) return [];
	return ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map((name) =>
		path.join(home, name)
	);
}

/**
 * The startup file of the user's shell that the `tm` alias would go in, or
 * why there is none: the shell isn't zsh or bash, or its file doesn't exist
 */
function aliasConfigFile(): { file: string } | { reason: string } {
	const home = homeDir();
	if (!home) return { reason: 'no home directory' };
	let file: string;
	if (process.env.SHELL?.includes('zsh')) {
		file = path.join(home, '.zshrc');
	} else if (process.env.SHELL?.includes('bash')) {
		file = path.join(home, '.bashrc');
	} else {
		return { reason: 'the shell is not zsh or bash' };
	}
	if (!fs.existsSync(file)) return { reason: `${file} not found` };
	return { file };
}

/**
 * The shell startup file the `tm` alias would be added to, or null when there
 * is none or it already has the alias, so init doesn't ask for nothing
 */
export function aliasMissingFile(): string | null {
	const found = aliasConfigFile();
	if (!('file' in found)) return null;
	const { file } = found;
	try {
		return fs.readFileSync(file, 'utf8').includes(ALIAS_LINE) ? null : file;
	} catch {
		return null;
	}
}

/**
 * Append the `tm` alias to the user's shell startup file, unless it's there
 * @returns null when the file has the alias, else why it couldn't be added
 */
export function addShellAliases(): string | null {
	const found = aliasConfigFile();
	if (!('file' in found)) return found.reason;
	const shellConfigFile = found.file;

	try {
		// `taskgraph` is already the command name, so `tm` is the only alias
		if (fs.readFileSync(shellConfigFile, 'utf8').includes(ALIAS_LINE)) {
			getLogger('Init').debug('All TaskGraph aliases already exist.');
			return null;
		}
		fs.appendFileSync(
			shellConfigFile,
			`\n# TaskGraph aliases added on ${new Date().toLocaleDateString()}\n${ALIAS_LINE}\n`
		);
		getLogger('Init').debug('Added 1 alias(es): tm');
		return null;
	} catch (error) {
		return (error as Error).message;
	}
}
