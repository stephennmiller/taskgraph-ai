/**
 * The `mcp` step of the build comparison: call one MCP tool on a build's
 * server (through the stdio smoke script) and turn the reply into files the
 * comparison can diff.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSnapshot } from './normalize.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const smokeScript = path.resolve(
	here,
	'../../../mcp/tests/smoke/mcp-stdio.smoke.mjs'
);
const STDERR_TAIL = 400;

export const isMcpStep = (step) =>
	Boolean(step) && !Array.isArray(step) && step.mcp !== undefined;

/**
 * The MCP server command that goes with a build: `.../dist/taskgraph.js`
 * becomes `.../dist/mcp-server.js`, and a build ending in the bin name
 * `taskgraph` (the npx form) becomes `taskgraph-mcp`.
 * @param {string} build
 * @returns {string|null} null when the build has neither form
 */
export function deriveServerCommand(build) {
	if (/\/dist\/taskgraph\.js["']?\s*$/.test(build)) {
		return build.replace(/taskgraph\.js(["']?\s*)$/, 'mcp-server.js$1');
	}
	if (/(?:^|[\s/])taskgraph\s*$/.test(build)) {
		return build.replace(/taskgraph(\s*)$/, 'taskgraph-mcp$1');
	}
	return null;
}

/** @throws {Error} When the build has no derivable server command */
export function serverFor(build) {
	const server = deriveServerCommand(build);
	if (!server) {
		throw new Error(
			`Cannot find the MCP server for build "${build}": the scenario has an mcp step, and the build must end in dist/taskgraph.js or in the bin name taskgraph`
		);
	}
	return server;
}

/**
 * Start the server, call one tool, and return the step result.
 * @param {object} o
 * @param {string} o.server Shell command that runs the MCP server
 * @param {string} o.tool
 * @param {object} o.input Tool arguments; "<project>" becomes projectDir
 * @param {number} o.timeout Per-request limit in ms
 * @param {string} o.projectDir
 * @param {string} o.workDir
 * @param {Record<string, string|undefined>} o.env
 * @param {number} o.index Step number, for the `mcp:N` file name
 * @param {boolean} o.withTools Also record the tool schemas as `mcp:tools`
 * @returns {{status: number|null, error?: string, stderr?: string, files: Record<string,string>}}
 *   status is 1 for an isError reply, 0 otherwise, null when no reply came back
 */
export function callMcpTool({
	server,
	tool,
	input,
	timeout,
	projectDir,
	workDir,
	env,
	index,
	withTools
}) {
	const resolved = JSON.parse(
		JSON.stringify(input).replaceAll(
			'<project>',
			JSON.stringify(projectDir).slice(1, -1)
		)
	);
	const res = spawnSync(
		process.execPath,
		[
			smokeScript,
			'--cwd',
			projectDir,
			'--timeout',
			String(timeout),
			'--schemas',
			'--call',
			tool,
			'--args',
			JSON.stringify(resolved),
			'--',
			'sh',
			'-c',
			`exec ${server}`
		],
		{
			cwd: projectDir,
			env,
			encoding: 'utf8',
			timeout: timeout * 3 + 10000
		}
	);
	let summary = null;
	try {
		summary = JSON.parse(res.stdout);
	} catch {
		// no summary: the smoke script or the server did not run
	}
	const call = summary?.calls?.[0];
	if (!call) {
		const why = summary?.failures?.join('; ') || res.stderr || '';
		return {
			status: null,
			error: res.error?.code ?? 'mcp-no-reply',
			stderr: why.trim().slice(-STDERR_TAIL),
			files: {}
		};
	}
	const text = call.content?.[0]?.text;
	let name = 'mcp-reply.txt';
	let body = text;
	if (typeof text !== 'string') {
		// a JSON-RPC error (content is null), or a reply with no text part
		name = 'mcp-reply.json';
		body = JSON.stringify({ content: call.content, error: call.error });
	} else {
		try {
			JSON.parse(text);
			name = 'mcp-reply.json';
		} catch {
			// plain text reply
		}
	}
	const ctx = { projectDir, workDir };
	const files = { [`mcp:${index}`]: normalizeSnapshot(name, body, ctx) };
	if (withTools) {
		files['mcp:tools'] = normalizeSnapshot(
			'mcp-tools.json',
			JSON.stringify(summary.toolSchemas ?? []),
			ctx
		);
	}
	return { status: call.isError ? 1 : 0, files };
}
