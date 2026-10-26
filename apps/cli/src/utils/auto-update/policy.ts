/**
 * @fileoverview When the CLI may install an update.
 *
 * The default is to tell the user a newer version exists and leave the
 * install to `taskgraph upgrade` (or an explicit opt-in). Some runs must
 * not install and must not ask: a script, CI, JSON output, or a process
 * started by `loop` or a parallel worker.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	LOOP_CHILD_ENV,
	PARALLEL_WORKER_ENV,
	SKIP_AUTO_UPDATE_ENV
} from '@tm/core';
import { wantsJsonOutput } from '../json-output.js';

/** `install` opts in; anything else (including unset) only notifies */
const AUTO_UPDATE_ENV = 'TASKGRAPH_AUTO_UPDATE';

/**
 * Opt-in file in the home directory. Not the project's
 * `.taskgraph/config.json`: that name would make the home directory look
 * like a TaskGraph project.
 */
const AUTO_UPDATE_FILE = 'auto-update.json';

/** Bigger than a one-key settings file; ignore it rather than stall startup */
const MAX_SETTINGS_BYTES = 64 * 1024;

/** Commands whose stdout is the whole output, so a notice would corrupt it */
const SILENT_COMMANDS = new Set(['completion', 'merge-driver']);

export interface AutoUpdateContext {
	argv?: readonly string[];
	env?: NodeJS.ProcessEnv;
	stdinIsTTY?: boolean;
	/** Home directory; defaults to os.homedir() */
	home?: string;
	/** `taskgraph upgrade`: refuse only in a process `loop` started */
	explicit?: boolean;
}

function context(options: AutoUpdateContext = {}) {
	const env = options.env ?? process.env;
	return {
		argv: options.argv ?? process.argv,
		env,
		stdinIsTTY: options.stdinIsTTY ?? Boolean(process.stdin.isTTY),
		// $HOME on each call. os.homedir() caches the first answer, so a test
		// (or a process that changes HOME) would otherwise read the wrong place.
		home:
			options.home ??
			env.HOME ??
			(process.platform === 'win32' ? env.USERPROFILE : undefined) ??
			os.homedir()
	};
}

/**
 * Why this run must not install or ask to install.
 * Null when a notice (and, if the user opted in, an install) is allowed.
 */
export function autoUpdateSkipReason(
	options: AutoUpdateContext = {}
): string | null {
	const { argv, env, stdinIsTTY } = context(options);
	if (env[LOOP_CHILD_ENV] === '1') return 'started by loop';
	if (env[PARALLEL_WORKER_ENV] === '1') return 'started by a parallel worker';
	if (options.explicit) return null;
	if (env[SKIP_AUTO_UPDATE_ENV] === '1') return 'TASKGRAPH_SKIP_AUTO_UPDATE=1';
	if (env.CI) return 'CI environment';
	if (env.NODE_ENV === 'test') return 'NODE_ENV=test';
	if (!stdinIsTTY) return 'stdin is not a terminal';

	const args = argv.slice(2);
	const command = args[0];
	if (command && SILENT_COMMANDS.has(command)) return `${command} output`;
	if (wantsJsonOutput(args)) return '--json output';
	return null;
}

/** True for the values that opt in to installing */
function optedIn(value: unknown): boolean | null {
	if (value === true) return true;
	if (value === false) return false;
	if (typeof value !== 'string') return null;
	switch (value.trim().toLowerCase()) {
		case 'install':
		case '1':
		case 'true':
		case 'yes':
			return true;
		case 'notify':
		case '0':
		case 'false':
		case 'no':
		case 'off':
			return false;
		default:
			return null;
	}
}

/**
 * Whether this machine installs updates on its own.
 * The environment variable wins over `~/.taskgraph/auto-update.json`.
 * Unset means notify only.
 */
export function isAutoInstallEnabled(options: AutoUpdateContext = {}): boolean {
	const { env, home } = context(options);
	const fromEnv = optedIn(env[AUTO_UPDATE_ENV]);
	if (fromEnv !== null) return fromEnv;
	return readAutoInstallSetting(home);
}

function readAutoInstallSetting(home: string): boolean {
	const file = path.join(home, '.taskgraph', AUTO_UPDATE_FILE);
	try {
		const stat = fs.statSync(file);
		if (!stat.isFile() || stat.size > MAX_SETTINGS_BYTES) return false;
		const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return false;
		}
		return optedIn((parsed as { autoUpdate?: unknown }).autoUpdate) === true;
	} catch {
		return false;
	}
}
