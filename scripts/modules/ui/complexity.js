import fs from 'fs';
import readline from 'readline';
import { printError, ui } from '@tm/cli';
import boxen from 'boxen';
import chalk from 'chalk';

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
		boxen(
			chalk.yellow(
				"It looks like you've already generated tasks for this project.\n"
			) +
				chalk.yellow(
					'Executing this command will overwrite any existing tasks.'
				),
			{
				padding: 1,
				borderColor: 'yellow',
				borderStyle: 'round',
				margin: { top: 1 }
			}
		)
	);

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

	const answer = await new Promise((resolve) => {
		rl.question(
			chalk.cyan('Are you sure you wish to continue? (y/N): '),
			resolve
		);
	});
	rl.close();

	return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}
