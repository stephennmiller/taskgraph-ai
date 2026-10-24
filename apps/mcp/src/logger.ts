/**
 * @fileoverview The MCP server's startup and registration log, on stderr so
 * it never mixes with the stdio protocol on stdout.
 */

import { findProjectRoot, readLogLevel } from '@tm/core';
import chalk from 'chalk';

const LOG_LEVELS = {
	debug: 0,
	info: 1,
	warn: 2,
	error: 3
} as const;

type Level = keyof typeof LOG_LEVELS;

const COLORS: Record<Level, (text: string) => string> = {
	debug: chalk.dim,
	info: chalk.blue,
	warn: chalk.yellow,
	error: chalk.red
};

const PREFIXES: Record<Level, string> = {
	debug: '[DEBUG]',
	info: '[INFO]',
	warn: '[WARN]',
	error: '[ERROR]'
};

function configuredLevel(): number {
	try {
		const level = readLogLevel(findProjectRoot());
		return LOG_LEVELS[level as Level] ?? LOG_LEVELS.info;
	} catch {
		return LOG_LEVELS.info;
	}
}

// Read once at startup, from the project the server was started in
const LOG_LEVEL = configuredLevel();

function log(level: Level, ...args: unknown[]) {
	if (LOG_LEVELS[level] < LOG_LEVEL) return;
	const color = COLORS[level];
	console.error(
		color(PREFIXES[level]),
		...args.map((arg) => (typeof arg === 'string' ? color(arg) : arg))
	);
}

export const logger = {
	debug: (...args: unknown[]) => log('debug', ...args),
	info: (...args: unknown[]) => log('info', ...args),
	warn: (...args: unknown[]) => log('warn', ...args),
	error: (...args: unknown[]) => log('error', ...args)
};
