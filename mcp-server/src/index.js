import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { FastMCP } from 'fastmcp';
import packageJson from '../../package.json' with { type: 'json' };
import logger from './logger.js';
import {
	getToolsConfiguration,
	registerTaskGraphTools
} from './tools/index.js';

dotenv.config({ quiet: true });

// Constants
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main MCP server class that integrates with TaskGraph
 */
class TaskGraphMCPServer {
	constructor() {
		this.options = {
			name: 'TaskGraph MCP Server',
			version: packageJson.version
		};

		// Create FastMCP instance
		const fastmcpServer = new FastMCP(this.options);

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

		this.logger.info('TaskGraph MCP Server starting...');
		this.logger.info(`Tool mode configuration: ${normalizedToolMode}`);

		const registrationResult = registerTaskGraphTools(
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

export default TaskGraphMCPServer;
