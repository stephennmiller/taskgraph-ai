/**
 * @fileoverview The TaskGraph MCP server: FastMCP over stdio with the tools
 * TASKGRAPH_TOOLS picks.
 */

import { FastMCP } from 'fastmcp';
import { logger } from './logger.js';
import { getVersionInfo } from './shared/utils.js';
import {
	getToolsConfiguration,
	registerTaskGraphTools
} from './tools/tool-registry.js';

/**
 * What the client tells the model about this server. Claude Code loads it at
 * startup even when tool schemas are deferred, so it says when to reach for
 * TaskGraph and which tools to start with. It names only core tools, which
 * every tool tier includes.
 */
export const SERVER_INSTRUCTIONS = [
	"TaskGraph tracks this project's tasks, their dependencies and status in .taskgraph/.",
	'Use next_task to pick what to work on, get_task for its details and done-when criteria, and set_task_status to claim it (in-progress) or close it (done).',
	'Log progress with add_note as you go, and file new work you find as a new task instead of doing it now.'
].join('\n');

export class TaskGraphMCPServer {
	readonly options = {
		name: 'TaskGraph MCP Server',
		version: getVersionInfo().version as `${number}.${number}.${number}`,
		instructions: SERVER_INSTRUCTIONS
	};
	readonly server = new FastMCP({
		...this.options,
		// FastMCP takes tool calls while it is still fetching the client's
		// roots; hold them until it has the roots so none skips the check
		onToolCall: () => this.connected
	});
	/**
	 * Resolves when the first client has connected. A tool's context.session
	 * is FastMCP's auth object, not the FastMCPSession, so each session's auth
	 * carries its roots (live: FastMCP swaps them on rootsChanged) for
	 * withNormalizedProjectRoot to bind projectRoot to (#794)
	 */
	private readonly connected = new Promise<void>((resolve) =>
		this.server.on('connect', ({ session }) => {
			session.updateAuth({
				get roots() {
					return session.roots;
				}
			});
			resolve();
		})
	);
	private initialized = false;

	/**
	 * Register the tools TASKGRAPH_TOOLS picks; a second call does nothing.
	 * Throws on a bad TASKGRAPH_TOOLS value or when any tool fails to register.
	 */
	init() {
		if (this.initialized) return this;

		const normalizedToolMode = getToolsConfiguration();

		logger.info('TaskGraph MCP Server starting...');
		logger.info(`Tool mode configuration: ${normalizedToolMode}`);

		const registrationResult = registerTaskGraphTools(
			this.server,
			normalizedToolMode
		);

		logger.info(`Normalized tool mode: ${registrationResult.normalizedMode}`);
		logger.info(
			`Registered ${registrationResult.registeredTools.length} tools successfully`
		);

		if (registrationResult.registeredTools.length > 0) {
			logger.debug(
				`Registered tools: ${registrationResult.registeredTools.join(', ')}`
			);
		}

		// A client would otherwise see a healthy server with tools missing
		if (registrationResult.failedTools.length > 0) {
			throw new Error(
				`Failed to register ${registrationResult.failedTools.length} tools: ${registrationResult.failedTools.join(', ')}`
			);
		}
		if (registrationResult.registeredTools.length === 0) {
			throw new Error('No MCP tools were registered');
		}

		this.initialized = true;
		return this;
	}

	async start() {
		this.init();

		this.server.on('connect', (event) => {
			// FastMCPSession has neither field, so this has always sent undefined
			// for both; kept so clients see the same message
			const { context, name } = event.session as unknown as {
				context?: unknown;
				name?: string;
			};
			event.session.server.sendLoggingMessage({
				data: { context, message: `MCP Server connected: ${name}` },
				level: 'info'
			});
		});

		await this.server.start({ transportType: 'stdio' });
		return this;
	}

	async stop() {
		await this.server.stop();
	}
}

/** Start the server on stdio, stopping it on SIGINT and SIGTERM */
export async function startServer() {
	const server = new TaskGraphMCPServer();

	const shutdown = async () => {
		await server.stop();
		process.exit(0);
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);

	try {
		await server.start();
	} catch (error) {
		logger.error(`Failed to start MCP server: ${(error as Error).message}`);
		process.exit(1);
	}
}
