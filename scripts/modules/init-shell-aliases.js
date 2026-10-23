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

// Function to add shell aliases to the user's shell configuration
// Silently checks each alias individually and adds only missing ones
function addShellAliases() {
	const homeDir = process.env.HOME || process.env.USERPROFILE;
	let shellConfigFile;

	// Determine which shell config file to use
	if (process.env.SHELL?.includes('zsh')) {
		shellConfigFile = path.join(homeDir, '.zshrc');
	} else if (process.env.SHELL?.includes('bash')) {
		shellConfigFile = path.join(homeDir, '.bashrc');
	} else {
		log('debug', 'Could not determine shell type. Aliases not added.');
		return false;
	}

	try {
		// Check if file exists
		if (!fs.existsSync(shellConfigFile)) {
			log('debug', `Shell config file ${shellConfigFile} not found.`);
			return false;
		}

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

export { ALIAS_LINE, addShellAliases, shellConfigFiles };
