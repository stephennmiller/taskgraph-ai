/**
 * init's console logger: icons per level, TASKGRAPH_LOG_LEVEL filtering and
 * the init-debug.log file when DEBUG=true.
 */
import fs from 'fs';
import { theme } from '@tm/cli/theme';
import chalk from 'chalk';
import { isSilentMode } from './utils.js';

// Define log levels
const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3,
	success: 4
};

// Determine log level from environment variable or default to 'info'
const LOG_LEVEL = process.env.TASKGRAPH_LOG_LEVEL
	? LOG_LEVELS[process.env.TASKGRAPH_LOG_LEVEL.toLowerCase()]
	: LOG_LEVELS.info; // Default to info

// Logging function with icons and colors
function log(level, ...args) {
	const icons = {
		debug: theme.muted('•'),
		info: theme.brand('→'),
		warn: chalk.yellow('!'),
		error: chalk.red('✗'),
		success: chalk.green('✓')
	};

	if (LOG_LEVELS[level] >= LOG_LEVEL) {
		const icon = icons[level] || '';

		// Only output to console if not in silent mode
		if (!isSilentMode()) {
			if (level === 'error') {
				console.error(icon, chalk.red(...args));
			} else if (level === 'warn') {
				console.warn(icon, chalk.yellow(...args));
			} else if (level === 'success') {
				console.log(icon, chalk.green(...args));
			} else if (level === 'info') {
				console.log(icon, theme.brand(...args));
			} else {
				console.log(icon, ...args);
			}
		}
	}

	// Write to debug log if DEBUG=true
	if (process.env.DEBUG === 'true') {
		const logMessage = `[${level.toUpperCase()}] ${args.join(' ')}\n`;
		fs.appendFileSync('init-debug.log', logMessage);
	}
}

// Steps report at debug level; the summary at the end says what changed.
// Warnings and errors still print as they happen.
function quietLog(level, ...args) {
	log(level === 'warn' || level === 'error' ? level : 'debug', ...args);
}

export { log, quietLog };
