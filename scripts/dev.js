#!/usr/bin/env node

/**
 * dev.js
 * TaskGraph CLI - AI-driven development task management
 *
 * This is the refactored entry point that uses the modular architecture.
 * It imports functionality from the modules directory and provides a CLI.
 */

// Must stay first: disables color before chalk loads when NO_COLOR is set
import './modules/no-color.js';
import { enableCompileCache } from 'node:module';

enableCompileCache();

const args = process.argv.slice(2);
const version = process.env.TM_PUBLIC_VERSION || 'unknown';

// `--version` and the top-level help screen are answered before the rest of
// the CLI loads (#248). Everything else is imported only when a command runs.
if (args.length === 1 && (args[0] === '--version' || args[0] === '-V')) {
	console.log(version);
} else {
	const help = await import('@tm/cli/help');
	if (help.isTopLevelHelpRequest(args)) {
		help.printTopLevelHelp(args, version);
	} else {
		await runCommand();
	}
}

async function runCommand() {
	const { join } = await import('node:path');
	const { findProjectRoot } = await import('@tm/core');
	const { default: dotenv } = await import('dotenv');

	// Store the original working directory
	// This is needed for commands that take relative paths as arguments
	const originalCwd = process.cwd();

	// Find project root for .env loading
	// We don't change the working directory to avoid breaking relative path logic
	const projectRoot = findProjectRoot();

	// Load .env from project root without changing cwd. quiet: dotenv 17+ logs
	// "injected env (N) from .env" otherwise, which led every command's output.
	dotenv.config({ path: join(projectRoot, '.env'), quiet: true });

	// Make original cwd available to commands that need it
	process.env.TASKGRAPH_ORIGINAL_CWD = originalCwd;

	if (process.env.DEBUG === '1') {
		console.error('DEBUG - dev.js received args:', args);
	}

	// Imported after dotenv.config() so module-level code sees the .env values
	const { runCLI } = await import('./modules/commands.js');

	// Run the CLI with the process arguments (not awaited, as before)
	runCLI(process.argv);
}
