import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as Sentry from '@sentry/node';
import dotenv from 'dotenv';
import { FastMCP } from 'fastmcp';
import packageJson from '../../package.json' with { type: 'json' };
import { initializeSentry } from '../../src/telemetry/sentry.js';
import logger from './logger.js';
import {
	getToolsConfiguration,
	registerTaskMasterTools
} from './tools/index.js';

dotenv.config({ quiet: true });

// Initialize Sentry after .env is loaded
initializeSentry();

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main MCP server class that integrates with Task Master
 */
class TaskMasterMCPServer {
	constructor() {
		this.options = {
			name: 'Task Master MCP Server',
			version: packageJson.version
		};

		// Create FastMCP instance
		const fastmcpServer = new FastMCP(this.options);

		// Wrap the underlying MCP server with Sentry instrumentation
		// FastMCP exposes the internal MCP server via _mcpServer property
		if (fastmcpServer._mcpServer && Sentry.wrapMcpServerWithSentry) {
			try {
				fastmcpServer._mcpServer = Sentry.wrapMcpServerWithSentry(
					fastmcpServer._mcpServer
				);
			} catch (error) {
				logger.warn(`Failed to wrap MCP server with Sentry: ${error.message}`);
			}
		}

		this.server = fastmcpServer;
		this.initialized = false;

		this.init = this.init.bind(this);
		this.start = this.start.bind(this);
		this.stop = this.stop.bind(this);

		this.logger = logger;
	}

	/**
	 * Initialize the MCP server with necessary tools and routes
	 */
	async init() {
		if (this.initialized) return;

		const normalizedToolMode = getToolsConfiguration();

		this.logger.info('Task Master MCP Server starting...');
		this.logger.info(`Tool mode configuration: ${normalizedToolMode}`);

		const registrationResult = registerTaskMasterTools(
			this.server,
			normalizedToolMode
		);

		this.logger.info(
			`Normalized tool mode: ${registrationResult.normalizedMode}`
		);
		this.logger.info(
			`Registered ${registrationResult.registeredTools.length} tools successfully`
		);

		if (registrationResult.registeredTools.length > 0) {
			this.logger.debug(
				`Registered tools: ${registrationResult.registeredTools.join(', ')}`
			);
		}

		if (registrationResult.failedTools.length > 0) {
			this.logger.warn(
				`Failed to register ${registrationResult.failedTools.length} tools: ${registrationResult.failedTools.join(', ')}`
			);
		}

		this.initialized = true;

		return this;
	}

	/**
	 * Start the MCP server
	 */
	async start() {
		if (!this.initialized) {
			await this.init();
		}

		this.server.on('connect', (event) => {
			event.session.server.sendLoggingMessage({
				data: {
					context: event.session.context,
					message: `MCP Server connected: ${event.session.name}`
				},
				level: 'info'
			});
		});

		// Start the FastMCP server with increased timeout
		await this.server.start({
			transportType: 'stdio',
			timeout: 120000 // 2 minutes timeout (in milliseconds)
		});

		return this;
	}

	/**
	 * Stop the MCP server
	 */
	async stop() {
		if (this.server) {
			await this.server.stop();
		}
	}
}

export default TaskMasterMCPServer;
