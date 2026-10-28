#!/usr/bin/env node
/**
 * @fileoverview The published MCP server entry, built to dist/mcp-server.js
 * (the taskgraph-mcp and taskgraph-ai bins).
 */

// Silences tm-core's console output, which would corrupt the stdio stream.
// Set before any import runs: modules build loggers at load time (#612).
process.env.TASKGRAPH_MCP = 'true';
// On Windows, cmd.exe and libuv otherwise run a git.exe or claude.cmd sitting in the project directory before the one on PATH
process.env.NoDefaultCurrentDirectoryInExePath = '1';

// `npx taskgraph-ai` runs this server, not the CLI. MCP clients never give it
// a terminal, so one means a person typed it: say what it is, on stderr
if (process.stdin.isTTY) {
	process.stderr.write(
		[
			'TaskGraph MCP server: waiting for an MCP client on stdin. Ctrl+C stops it.',
			'For the CLI, run npx -p taskgraph-ai taskgraph, or install it with',
			'npm install -g taskgraph-ai and run taskgraph.',
			''
		].join('\n')
	);
}

const { startServer } = await import('./server.js');
startServer();

// Marks the file as a module, which top-level await needs
export {};
