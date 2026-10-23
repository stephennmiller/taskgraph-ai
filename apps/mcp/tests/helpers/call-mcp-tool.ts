/**
 * @fileoverview Call one MCP tool on the built server (dist/mcp-server.js)
 * through the stdio smoke script, from a test.
 *
 * Runs in the current working directory, so tests that chdir into a temp
 * project get a server rooted there. Needs the build.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const smokeScript = path.resolve(__dirname, '../smoke/mcp-stdio.smoke.mjs');

/**
 * @param toolName MCP tool to call (the server runs with all tools enabled)
 * @param args Tool arguments, sent as JSON
 * @returns The tool's reply: the text of its first content item, parsed as JSON
 * @throws When the server fails, the call errors, or the reply is not JSON
 */
export function callMCPTool(
	toolName: string,
	args: Record<string, unknown>
): any {
	// The server uses this variable when a call passes no projectRoot, so a
	// value in the developer's shell would send such calls into their project
	const { TASKGRAPH_PROJECT_ROOT: _ignored, ...env } = process.env;
	const run = spawnSync(
		process.execPath,
		[
			smokeScript,
			'--call',
			toolName,
			'--args',
			JSON.stringify(args),
			'--timeout',
			'20000'
		],
		{ encoding: 'utf8', timeout: 25000, env }
	);

	const summary = JSON.parse(run.stdout || '{}');
	const call = summary.calls?.[0];
	if (run.status !== 0 || !call || call.isError) {
		throw new Error(
			`MCP tool ${toolName} failed: ${run.stderr || JSON.stringify(call)}`
		);
	}
	return JSON.parse(call.content[0].text);
}
