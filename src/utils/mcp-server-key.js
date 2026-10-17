/**
 * Key under which this package's MCP server is registered in client configs
 * (mcp.json, settings.json, ...). Earlier task-master-ai installs used other
 * keys, so lookups and cleanups also accept those.
 */
export const MCP_SERVER_KEY = 'taskgraph-ai';

export const LEGACY_MCP_SERVER_KEYS = ['task-master-ai'];

/**
 * Find the key of this package's server in a map of MCP servers.
 * @param {Object} [servers] - Map of server key to server config
 * @returns {string|undefined} The current key if present, else a legacy key
 */
export function findMcpServerKey(servers) {
	if (!servers) return undefined;
	return [MCP_SERVER_KEY, ...LEGACY_MCP_SERVER_KEYS].find(
		(key) => servers[key]
	);
}

/**
 * Whether an MCP server config launches this package (or an earlier
 * task-master-ai install), judged by its args, e.g. ['-y', 'taskgraph-ai'].
 * @param {Object} [server] - A single MCP server config
 * @returns {boolean}
 */
export function launchesTaskMasterPackage(server) {
	const names = [MCP_SERVER_KEY, ...LEGACY_MCP_SERVER_KEYS];
	return (
		Array.isArray(server?.args) &&
		server.args.some(
			(arg) => typeof arg === 'string' && names.some((n) => arg.includes(n))
		)
	);
}
