/**
 * Key under which this package's MCP server is registered in client configs
 * (mcp.json, settings.json, ...).
 */
export const MCP_SERVER_KEY = 'taskgraph-ai';

/**
 * Whether an MCP server config launches this package, judged by its args,
 * e.g. ['-y', 'taskgraph-ai'].
 * @param {Object} [server] - A single MCP server config
 * @returns {boolean}
 */
export function launchesTaskGraphPackage(server) {
	return (
		Array.isArray(server?.args) &&
		server.args.some(
			(arg) => typeof arg === 'string' && arg.includes(MCP_SERVER_KEY)
		)
	);
}
