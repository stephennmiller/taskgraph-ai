/**
 * @fileoverview How TaskGraph's MCP server appears in a client config such
 * as a project's `.mcp.json`.
 */

/** Key the MCP server is registered under in client configs */
export const MCP_SERVER_KEY = 'taskgraph-ai';

/**
 * Whether an MCP server config launches this package, judged by its args,
 * e.g. `['-y', 'taskgraph-ai']`.
 */
export function launchesTaskGraphPackage(server: unknown): boolean {
	const args = (server as { args?: unknown } | null | undefined)?.args;
	return (
		Array.isArray(args) &&
		args.some((arg) => typeof arg === 'string' && arg.includes(MCP_SERVER_KEY))
	);
}
