import fs from 'fs';
import readline from 'readline';
import { printError, ui } from '@tm/cli';
import chalk from 'chalk';
import { theme } from './theme.js';

/**
 * Show the complexity report: each task with its score, recommended
 * subtasks and the reasoning, highest score first.
 *
 * Without a report it says how to make one and exits 1. It used to ask
 * whether to run the analysis, which hung any script or agent that ran it.
 * @param {string} reportPath - Path to the complexity report file
 */
export async function displayComplexityReport(reportPath) {
	if (!fs.existsSync(reportPath)) {
		printError(
			'No complexity report for this tag yet',
			'Run `taskgraph analyze-complexity` to create one'
		);
		process.exit(1);
	}

	let report;
	try {
		report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
	} catch (error) {
		printError(
			`Couldn't read the complexity report: ${error.message}`,
			'Run `taskgraph analyze-complexity` to create it again'
		);
		process.exit(1);
	}

	console.log(ui.formatComplexityReport(report));
}

/**
 * Confirm overwriting existing tasks.json file
 * @param {string} tasksPath - Path to the tasks.json file
 * @returns {Promise<boolean>} - Promise resolving to true if user confirms, false otherwise
 */
export async function confirmTaskOverwrite(tasksPath) {
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
