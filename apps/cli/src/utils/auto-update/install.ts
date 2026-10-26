/**
 * @fileoverview Package installation operations
 *
 * An install (the explicit `taskgraph upgrade`, or a run that opted in)
 * takes one lock under `~/.taskgraph`. A second run skips instead of
 * starting another `npm install -g`. A lock left by a crashed install is
 * reclaimed once it is stale.
 */

import { spawn } from 'child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import chalk from 'chalk';

import { PACKAGE_NAME } from './constants.js';
import { autoUpdateSkipReason, type AutoUpdateContext } from './policy.js';

import { createSpinner } from '../../ui/spinner.js';
import { theme } from '../../ui/theme.js';

/** An install that never finished is stale after this long */
const UPDATE_LOCK_STALE_MS = 30 * 60 * 1000;

const LOCK_FILE = 'update.lock';

interface UpdateLock {
	pid: number;
	startedAt: number;
}

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

function lockPath(home: string): string {
	return path.join(home, '.taskgraph', LOCK_FILE);
}

function readLock(file: string): UpdateLock | null {
	try {
		const data = JSON.parse(
			fs.readFileSync(file, 'utf8')
		) as Partial<UpdateLock>;
		if (typeof data.pid !== 'number' || typeof data.startedAt !== 'number') {
			return null;
		}
		return { pid: data.pid, startedAt: data.startedAt };
	} catch {
		return null;
	}
}

/** A dead pid, or a lock older than the stale window, can be taken over */
function lockIsStale(info: UpdateLock | null): boolean {
	if (!info) return true;
	if (Date.now() - info.startedAt > UPDATE_LOCK_STALE_MS) return true;
	if (!Number.isInteger(info.pid) || info.pid <= 0) return true;
	try {
		process.kill(info.pid, 0);
		return false;
	} catch (error) {
		// EPERM: the process exists and belongs to someone else
		return (error as NodeJS.ErrnoException).code !== 'EPERM';
	}
}

/**
 * Create the lock file exclusively. One retry reclaims a stale lock.
 * mkdir of the directory is not the lock: two processes can both mkdir.
 */
function acquireUpdateLock(home: string): boolean {
	const file = lockPath(home);
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
	} catch {
		// Can't create ~/.taskgraph: skip the install rather than run it unlocked
		return false;
	}
	const body = JSON.stringify({ pid: process.pid, startedAt: Date.now() });
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.writeFileSync(file, body, { flag: 'wx' });
			return true;
		} catch (error) {
			const code = (error as NodeJS.ErrnoException).code;
			if (code !== 'EEXIST' || attempt === 1) return false;
			if (!lockIsStale(readLock(file))) return false;
			try {
				fs.unlinkSync(file);
			} catch (unlinkError) {
				if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
					return false;
				}
			}
		}
	}
	return false;
}

/** Remove the lock only when this process still owns it */
function releaseUpdateLock(home: string): void {
	const file = lockPath(home);
	const info = readLock(file);
	if (!info || info.pid !== process.pid) return;
	try {
		fs.unlinkSync(file);
	} catch {
		// A later run reclaims it once the timestamp is stale
	}
}

/**
 * Install taskgraph-ai at `latestVersion`.
 *
 * Returns false without installing when this run must not (no terminal,
 * CI, JSON, a loop child, a parallel worker) or when another install
 * already holds the lock. Callers decide whether to install at all: the
 * default is to notify and not call this.
 */
export async function performAutoUpdate(
	latestVersion: string,
	options: AutoUpdateContext = {}
): Promise<boolean> {
	const reason = autoUpdateSkipReason(options);
	if (reason) {
		console.log(chalk.dim(`Skipping auto-update (${reason})`));
		return false;
	}

	const home = options.home ?? os.homedir();
	if (!acquireUpdateLock(home)) {
		console.log(
			chalk.dim('Skipping auto-update (another update is in progress)')
		);
		return false;
	}

	try {
		return await installFromNpm(latestVersion);
	} finally {
		releaseUpdateLock(home);
	}
}
