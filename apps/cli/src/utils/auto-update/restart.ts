/**
 * @fileoverview CLI restart functionality after update
 */

import { spawn } from 'child_process';
import process from 'process';

import { SKIP_AUTO_UPDATE_ENV } from '@tm/core';
import chalk from 'chalk';

/**
 * Restart the CLI with the newly installed version
 * @param argv - Original command-line arguments (process.argv)
 */
export function restartWithNewVersion(argv: string[]): void {
	console.log(chalk.dim('Restarting with updated version...\n'));

	// npm installed the new version over the entry script this run started
	// from. Node runs it directly, with no shell to split or read the user's
	// arguments (Windows would need one to start the taskgraph.cmd shim).
	const child = spawn(process.execPath, argv.slice(1), {
		stdio: 'inherit', // Inherit stdin/stdout/stderr so it looks seamless
		// If npm installed somewhere else, the old version must not update again
		env: { ...process.env, [SKIP_AUTO_UPDATE_ENV]: '1' }
	});

	child.on('exit', (code, signal) => {
		if (signal) {
			process.kill(process.pid, signal);
			return;
		}
		process.exit(code ?? 0);
	});

	child.on('error', (error) => {
		console.error(
			chalk.red('Failed to restart with new version:'),
			error.message
		);
		console.log(chalk.yellow('Please run your command again manually.'));
		process.exit(1);
	});
}
