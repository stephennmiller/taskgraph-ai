/**
 * @fileoverview TmCore - Unified facade for all TaskGraph functionality
 * This is the ONLY entry point for using tm-core
 */

import path from 'node:path';
import { ConfigDomain } from './modules/config/config-domain.js';
import { ConfigManager } from './modules/config/managers/config-manager.js';
import { GitDomain } from './modules/git/git-domain.js';
import { GitHubDomain } from './modules/github/github-domain.js';
import { LoopDomain } from './modules/loop/loop-domain.js';
import { TasksDomain } from './modules/tasks/tasks-domain.js';

import {
	ERROR_CODES,
	TaskGraphError
} from './common/errors/taskgraph-error.js';
import {
	type Logger,
	type LoggerConfig,
	createLogger
} from './common/logger/index.js';

/**
 * Options for creating TmCore instance
 */
export interface TmCoreOptions {
	/** Absolute path to project root */
	projectPath: string;
	/** Optional logger configuration for MCP integration and debugging */
	loggerConfig?: LoggerConfig;
}

/**
 * TmCore - Unified facade providing access to all TaskGraph domains
 *
 * @example Basic usage
 * ```typescript
 * const tmcore = await createTmCore({ projectPath: process.cwd() });
 *
 * // Access any domain
 * const { tasks } = await tmcore.tasks.list();
 * await tmcore.git.createCommit('feat: add feature');
 * const modelConfig = tmcore.config.getModelConfig();
 * ```
 *
 * @example MCP integration with logging
 * ```typescript
 * // In MCP tool execute function
 * async function execute(args, log) {
 *   const tmcore = await createTmCore({
 *     projectPath: args.projectRoot,
 *     loggerConfig: {
 *       mcpMode: true,
 *       logCallback: log  // MCP log function
 *     }
 *   });
 *
 *   // All internal logging will now be sent to MCP
 *   const { tasks } = await tmcore.tasks.list();
 *
 *   // You can also log custom messages
 *   tmcore.logger.info('Operation completed');
 * }
 * ```
 */
export class TmCore {
	// Core infrastructure
	private readonly _projectPath: string;
	private _configManager!: ConfigManager;
	private _logger!: Logger;

	// Private writable properties
	private _tasks!: TasksDomain;
	private _git!: GitDomain;
	private _config!: ConfigDomain;
	private _loop!: LoopDomain;
	private _github!: GitHubDomain;

	// Public readonly getters
	get tasks(): TasksDomain {
		return this._tasks;
	}
	get git(): GitDomain {
		return this._git;
	}
	get config(): ConfigDomain {
		return this._config;
	}
	get loop(): LoopDomain {
		return this._loop;
	}
	get github(): GitHubDomain {
		return this._github;
	}
	get logger(): Logger {
		return this._logger;
	}

	/**
	 * Create and initialize a new TmCore instance
	 * This is the ONLY way to create TmCore
	 *
	 * @param options - Configuration options
	 * @returns Fully initialized TmCore instance
	 */
	static async create(options: TmCoreOptions): Promise<TmCore> {
		const instance = new TmCore(options);
		await instance.initialize();
		return instance;
	}

	private _options: TmCoreOptions;

	/**
	 * Private constructor - use TmCore.create() instead
	 * This ensures TmCore is always properly initialized
	 */
	private constructor(options: TmCoreOptions) {
		if (!options.projectPath) {
			throw new TaskGraphError(
				'Project path is required',
				ERROR_CODES.MISSING_CONFIGURATION
			);
		}

		// Validate that projectPath is absolute
		if (!path.isAbsolute(options.projectPath)) {
			throw new TaskGraphError(
				`Project path must be an absolute path, received: "${options.projectPath}"`,
				ERROR_CODES.INVALID_INPUT
			);
		}

		// Normalize the path
		this._projectPath = path.resolve(options.projectPath);
		this._options = options;
		// Domain facades will be initialized in initialize()
	}

	/**
	 * Initialize the TmCore instance
	 * Private - only called by the factory method
	 */
	private async initialize(): Promise<void> {
		try {
			// Initialize logger first (before anything else that might log)
			this._logger = createLogger(this._options.loggerConfig);

			// Create config manager
			this._configManager = await ConfigManager.create(this._projectPath);

			// Initialize domain facades
			this._tasks = new TasksDomain(this._configManager);
			this._git = new GitDomain(this._projectPath);
			this._config = new ConfigDomain(this._configManager);
			this._loop = new LoopDomain(this._configManager, this._tasks);

			// Initialize domains that need async setup
			await this._tasks.initialize();

			// Wire up cross-domain dependencies
			// GitHubDomain reads and writes task links through TasksDomain
			this._github = new GitHubDomain(this._projectPath, {
				getActiveTag: () => this._configManager.getActiveTag()
			});
			this._github.setTasksDomain(this._tasks);

			// Log successful initialization
			this._logger.info('TmCore initialized successfully');
		} catch (error) {
			// Log error if logger is available
			if (this._logger) {
				this._logger.error('Failed to initialize TmCore:', error);
			}

			throw new TaskGraphError(
				'Failed to initialize TmCore',
				ERROR_CODES.INTERNAL_ERROR,
				{ operation: 'initialize' },
				error as Error
			);
		}
	}

	/**
	 * Get project root path
	 */
	get projectPath(): string {
		return this._projectPath;
	}

	/**
	 * Close and cleanup resources
	 * Releases file locks and other storage resources
	 * Should be called when done using TmCore, especially in tests
	 */
	async close(): Promise<void> {
		if (this._tasks) {
			await this._tasks.close();
		}
	}
}

/**
 * Factory function to create a new TmCore instance
 * This is the recommended way to create TmCore
 *
 * @param options - Configuration options
 * @returns Fully initialized TmCore instance
 */
export async function createTmCore(options: TmCoreOptions): Promise<TmCore> {
	return TmCore.create(options);
}
