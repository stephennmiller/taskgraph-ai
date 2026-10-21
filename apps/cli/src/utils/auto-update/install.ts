/**
 * @fileoverview Package installation operations
 */

import { spawn } from 'child_process';

import chalk from 'chalk';

import { PACKAGE_NAME } from './constants.js';

import { createSpinner } from '../../ui/spinner.js';
import { theme } from '../../ui/theme.js';

/**
 * Install through npm, which checks the registry's integrity hash itself
 */
async function installFromNpm(latestVersion: string): Promise<boolean> {
	const spinner = createSpinner(
		theme.brand(
			`Updating ${PACKAGE_NAME} to version ${chalk.green(latestVersion)}`
		)
	).start();

	return new Promise((resolve) => {
		const updateProcess = spawn(
			'npm',
			[
				'install',
				'-g',
				`${PACKAGE_NAME}@${latestVersion}`,
				'--no-fund',
				'--no-audit',
				'--loglevel=warn'
			],
			{
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);

		let errorOutput = '';

		updateProcess.stdout.on('data', () => {
			spinner.text = theme.brand(
				`Installing ${PACKAGE_NAME}@${latestVersion}...`
			);
		});

		updateProcess.stderr.on('data', (data) => {
			errorOutput += data.toString();
		});

		updateProcess.on('close', (code) => {
			if (code === 0) {
				spinner.succeed(
					chalk.green(
						`Successfully updated to version ${chalk.bold(latestVersion)}`
					)
				);
				resolve(true);
			} else {
				spinner.fail(chalk.red('Auto-update failed'));
				console.log(
					chalk.cyan(
						`Please run manually: npm install -g ${PACKAGE_NAME}@${latestVersion}`
					)
				);
				if (errorOutput) {
					console.log(chalk.dim(`Error: ${errorOutput.trim()}`));
				}
				resolve(false);
			}
		});

		updateProcess.on('error', (error) => {
			spinner.fail(chalk.red('Auto-update failed'));
			console.log(chalk.red('Error:'), error.message);
			console.log(
				chalk.cyan(
					`Please run manually: npm install -g ${PACKAGE_NAME}@${latestVersion}`
				)
			);
			resolve(false);
		});
	});
}

/**
 * Automatically update taskgraph-ai to the latest version
 */
export async function performAutoUpdate(
	latestVersion: string
): Promise<boolean> {
	if (
		process.env.TASKGRAPH_SKIP_AUTO_UPDATE === '1' ||
		process.env.CI ||
		process.env.NODE_ENV === 'test'
	) {
		const reason =
			process.env.TASKGRAPH_SKIP_AUTO_UPDATE === '1'
				? 'TASKGRAPH_SKIP_AUTO_UPDATE=1'
				: process.env.CI
					? 'CI environment'
					: 'NODE_ENV=test';
		console.log(chalk.dim(`Skipping auto-update (${reason})`));
		return false;
	}

	return installFromNpm(latestVersion);
}
