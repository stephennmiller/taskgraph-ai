import readline from 'readline';
import { printError } from '@tm/cli';
import chalk from 'chalk';
import { theme } from './theme.js';

/**
 * Confirm overwriting existing tasks.json file
 * @param {string} tasksPath - Path to the tasks.json file
 * @returns {Promise<boolean>} - Promise resolving to true if user confirms, false otherwise
 */
export async function confirmTaskOverwrite(tasksPath) {
	// Without a terminal nobody can answer, and readline would wait forever
	if (!process.stdin.isTTY) {
		printError(
			"This tag has tasks and there's no terminal to ask before replacing them",
			'Run again with --append to add to them or --force to replace them'
		);
		process.exit(1);
	}

	console.log(
		`${chalk.yellow('⚠')} This tag has tasks; parse-prd replaces them` +
			theme.muted(' (--append adds to them)')
	);

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	const answer = await new Promise((resolve) => {
		rl.question(theme.brand('Replace them? (y/N) '), resolve);
	});
	rl.close();

	return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
