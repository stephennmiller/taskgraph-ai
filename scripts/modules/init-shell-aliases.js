/** The `tm` shell alias init adds to the user's shell config */
import fs from 'fs';
import path from 'path';
import { log } from './init-log.js';

// The alias init adds to the shell config
const ALIAS_LINE = "alias tm='taskgraph'";

/**
 * Shell startup files init may append the `tm` alias to, so the summary can
 * say which one changed.
 */
function shellConfigFiles() {
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	if (!homeDir) return [];
	return ['.zshrc', '.bashrc', '.bash_profile', '.profile'].map((name) =>
		path.join(homeDir, name)
	);
}

/**
 * The startup file of the user's shell that the `tm` alias would go in, or
 * null when the shell isn't zsh or bash, or its file doesn't exist.
 * @returns {string|null}
 */
function aliasConfigFile() {
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	if (!homeDir) return null;
	let file;
	if (process.env.SHELL?.includes('zsh')) {
		file = path.join(homeDir, '.zshrc');
	} else if (process.env.SHELL?.includes('bash')) {
		file = path.join(homeDir, '.bashrc');
	} else {
		log('debug', 'Could not determine shell type. Aliases not added.');
		return null;
	}
	if (!fs.existsSync(file)) {
		log('debug', `Shell config file ${file} not found.`);
		return null;
	}
	return file;
}

/**
 * The shell startup file the `tm` alias would be added to, or null when there
 * is none or it already has the alias, so init doesn't ask for nothing.
 * @returns {string|null}
 */
function aliasMissingFile() {
	const file = aliasConfigFile();
	if (!file) return null;
	try {
		return fs.readFileSync(file, 'utf8').includes(ALIAS_LINE) ? null : file;
	} catch {
		return null;
	}
}

/**
 * Append the `tm` alias to the user's shell startup file, unless it's there.
 * init calls this only with --aliases or a Yes to its question.
 */
function addShellAliases() {
	const shellConfigFile = aliasConfigFile();
	if (!shellConfigFile) return false;

	try {
		const configContent = fs.readFileSync(shellConfigFile, 'utf8');

		// `taskgraph` is already the command name, so `tm` is the only alias
		const aliases = [{ name: 'tm', line: ALIAS_LINE }];

		// Check which aliases are missing
		const missingAliases = aliases.filter(
			(alias) => !configContent.includes(alias.line)
		);

		if (missingAliases.length === 0) {
			log('debug', 'All TaskGraph aliases already exist.');
			return true;
		}

		// Build alias block with only missing aliases
		const aliasLines = missingAliases.map((a) => a.line).join('\n');
		const aliasBlock = `
# TaskGraph aliases added on ${new Date().toLocaleDateString()}
${aliasLines}
`;

		fs.appendFileSync(shellConfigFile, aliasBlock);
		log(
			'debug',
			`Added ${missingAliases.length} alias(es): ${missingAliases.map((a) => a.name).join(', ')}`
		);

		return true;
	} catch (error) {
		log('debug', `Failed to add aliases: ${error.message}`);
		return false;
	}
}

export { ALIAS_LINE, addShellAliases, aliasMissingFile, shellConfigFiles };
