#!/usr/bin/env node

/**
 * dev.js
 * TaskGraph CLI - AI-driven development task management
 *
 * This is the refactored entry point that uses the modular architecture.
 * It imports functionality from the modules directory and provides a CLI.
 */

// Must stay first: disables color before chalk loads when NO_COLOR is set
import '@tm/cli/no-color';
import nodeModule from 'node:module';

// Caches compiled code between runs (#248). Optional call: a named import
// would fail to link on a Node without it, before engines can be reported.
nodeModule.enableCompileCache?.();

const args = process.argv.slice(2);
const version = process.env.TM_PUBLIC_VERSION || 'unknown';

// `--version`, bare `taskgraph` and the top-level help screen are answered
// before the rest of the CLI loads (#248). Everything else is imported only
// when a command runs.
if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
	console.log(version);
} else {
	const help = await import('@tm/cli/help');
	if (
		args.every((a) => a === '--no-banner') ||
		help.isTopLevelHelpRequest(args)
	) {
		help.printTopLevelHelp(args, version);
	} else {
		await runCommand();
	}
}

async function runCommand() {
	// On Windows, cmd.exe and libuv otherwise run a git.exe or claude.cmd sitting in the project directory before the one on PATH
	process.env.NoDefaultCurrentDirectoryInExePath = '1';

	// The project's .env is never loaded into process.env, which the Claude
	// Code subprocess inherits: tm-core reads the keys it supports per project
	// (readProjectEnv), so a cloned repo's .env can't set anything else.

	// Store the original working directory
	// This is needed for commands that take relative paths as arguments
	process.env.TASKGRAPH_ORIGINAL_CWD = process.cwd();

	if (process.env.DEBUG === '1') {
		console.error('DEBUG - dev.js received args:', args);
	}

	const { runCLI } = await import('@tm/cli');

	// Run the CLI with the process arguments (not awaited, as before)
	runCLI(process.argv);
}
