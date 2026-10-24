/**
 * Path utility functions for TaskGraph
 * Provides centralized path resolution logic for both CLI and MCP use cases
 *
 * NOTE: This file is a legacy wrapper around @tm/core utilities.
 * New code should import directly from @tm/core instead.
 * This file exists for backward compatibility during the migration period.
 */

import fs from 'fs';
import path from 'path';
import {
	findProjectRoot as findProjectRootCore,
	normalizeProjectRoot as normalizeProjectRootCore
} from '@tm/core';
import { isConfigWarningSuppressed } from '../../scripts/modules/config-manager.js';
import {
	COMPLEXITY_REPORT_FILE,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_DOCS_DIR,
	TASKGRAPH_REPORTS_DIR,
	TASKGRAPH_TASKS_FILE
} from '../constants/paths.js';
import { getLoggerOrDefault } from './logger-utils.js';

/**
 * Normalize project root to ensure it doesn't end with .taskgraph
 * This prevents double .taskgraph paths when using constants that include .taskgraph
 *
 * @deprecated Use the TypeScript implementation from @tm/core instead
 * @param {string} projectRoot - The project root path to normalize
 * @returns {string} - Normalized project root path
 */
export function normalizeProjectRoot(projectRoot) {
	return normalizeProjectRootCore(projectRoot);
}

/**
 * Find the project root directory by looking for project markers
 * Traverses upwards from startDir until a project marker is found or filesystem root is reached
 * Limited to 50 parent directory levels to prevent excessive traversal
 *
 * Strategy: First searches ALL parent directories for .taskgraph (highest priority).
 * If not found, then searches for other project markers starting from current directory.
 * This ensures .taskgraph in parent directories takes precedence over other markers in subdirectories.
 *
 * @deprecated Use the TypeScript implementation from @tm/core instead
 * @param {string} startDir - Directory to start searching from (defaults to process.cwd())
 * @returns {string} - Project root path (falls back to current directory if no markers found)
 */
function findProjectRoot(startDir = process.cwd()) {
	return findProjectRootCore(startDir);
}

/**
 * Find the tasks.json file path with fallback logic
 * @param {string|null} explicitPath - Explicit path provided by user (highest priority)
 * @param {Object|null} args - Args object from MCP args (optional)
 * @param {Object|null} log - Logger object (optional)
 * @returns {string|null} - Resolved tasks.json path or null if not found
 */
export function findTasksPath(explicitPath = null, args = null, log = null) {
	// Use the passed logger if available, otherwise use the default logger
	const logger = getLoggerOrDefault(log);

	// 1. First determine project root to use as base for all path resolution
	const rawProjectRoot = args?.projectRoot || findProjectRoot();

	if (!rawProjectRoot) {
		logger.warn?.('Could not determine project root directory');
		return null;
	}

	// 2. Normalize project root to prevent double .taskgraph paths
	const projectRoot = normalizeProjectRoot(rawProjectRoot);

	// 3. If explicit path is provided, resolve it relative to project root (highest priority)
	if (explicitPath) {
		const resolvedPath = path.isAbsolute(explicitPath)
			? explicitPath
			: path.resolve(projectRoot, explicitPath);

		if (fs.existsSync(resolvedPath)) {
			logger.info?.(`Using explicit tasks path: ${resolvedPath}`);
			return resolvedPath;
		} else {
			logger.warn?.(
				`Explicit tasks path not found: ${resolvedPath}, trying fallbacks`
			);
		}
	}

	// 4. Look in the .taskgraph directory
	const tasksPath = path.join(projectRoot, TASKGRAPH_TASKS_FILE);
	if (fs.existsSync(tasksPath)) {
		logger.info?.(`Found tasks file at: ${tasksPath}`);
		return tasksPath;
	}

	logger.warn?.(`No tasks.json found in project: ${projectRoot}`);
	return null;
}

/**
 * Find the PRD document file path with fallback logic
 * @param {string|null} explicitPath - Explicit path provided by user (highest priority)
 * @param {Object|null} args - Args object for MCP context (optional)
 * @param {Object|null} log - Logger object (optional)
 * @returns {string|null} - Resolved PRD document path or null if not found
 */
export function findPRDPath(explicitPath = null, args = null, log = null) {
	const logger = getLoggerOrDefault(log);

	// 1. If explicit path is provided, use it (highest priority)
	if (explicitPath) {
		// Use original cwd if available (set by dev.js), otherwise current cwd
		// This ensures relative paths are resolved from where the user invoked the command
		const cwdForResolution =
			process.env.TASKGRAPH_ORIGINAL_CWD || process.cwd();

		const resolvedPath = path.isAbsolute(explicitPath)
			? explicitPath
			: path.resolve(cwdForResolution, explicitPath);

		if (fs.existsSync(resolvedPath)) {
			logger.info?.(`Using explicit PRD path: ${resolvedPath}`);
			return resolvedPath;
		} else {
			logger.warn?.(
				`Explicit PRD path not found: ${resolvedPath}, trying fallbacks`
			);
		}
	}

	// 2. Try to get project root from args (MCP) or find it
	const rawProjectRoot = args?.projectRoot || findProjectRoot();

	if (!rawProjectRoot) {
		logger.warn?.('Could not determine project root directory');
		return null;
	}

	// 3. Normalize project root to prevent double .taskgraph paths
	const projectRoot = normalizeProjectRoot(rawProjectRoot);

	// 4. Look in the .taskgraph/docs directory
	const fileNames = ['PRD.md', 'prd.md', 'PRD.txt', 'prd.txt'];

	for (const fileName of fileNames) {
		const prdPath = path.join(projectRoot, TASKGRAPH_DOCS_DIR, fileName);
		if (fs.existsSync(prdPath)) {
			logger.info?.(`Found PRD document at: ${prdPath}`);
			return prdPath;
		}
	}

	logger.warn?.(`No PRD document found in project: ${projectRoot}`);
	return null;
}

/**
 * Find the complexity report file path with fallback logic
 * @param {string|null} explicitPath - Explicit path provided by user (highest priority)
 * @param {Object|null} args - Args object for MCP context (optional)
 * @param {Object|null} log - Logger object (optional)
 * @returns {string|null} - Resolved complexity report path or null if not found
 */
export function findComplexityReportPath(
	explicitPath = null,
	args = null,
	log = null
) {
	const logger = getLoggerOrDefault(log);

	// 1. If explicit path is provided, use it (highest priority)
	if (explicitPath) {
		// Use original cwd if available (set by dev.js), otherwise current cwd
		const cwdForResolution =
			process.env.TASKGRAPH_ORIGINAL_CWD || process.cwd();

		const resolvedPath = path.isAbsolute(explicitPath)
			? explicitPath
			: path.resolve(cwdForResolution, explicitPath);

		if (fs.existsSync(resolvedPath)) {
			logger.info?.(`Using explicit complexity report path: ${resolvedPath}`);
			return resolvedPath;
		} else {
			logger.warn?.(
				`Explicit complexity report path not found: ${resolvedPath}, trying fallbacks`
			);
		}
	}

	// 2. Try to get project root from args (MCP) or find it
	const rawProjectRoot = args?.projectRoot || findProjectRoot();

	if (!rawProjectRoot) {
		logger.warn?.('Could not determine project root directory');
		return null;
	}

	// 3. Normalize project root to prevent double .taskgraph paths
	const projectRoot = normalizeProjectRoot(rawProjectRoot);

	// 4. Look in the .taskgraph/reports directory
	const fileNames = [
		'task-complexity-report',
		'task-complexity',
		'complexity-report'
	].map((fileName) => {
		if (args?.tag && args?.tag !== 'master') {
			return `${fileName}_${args.tag}.json`;
		}
		return `${fileName}.json`;
	});

	for (const fileName of fileNames) {
		const reportPath = path.join(projectRoot, TASKGRAPH_REPORTS_DIR, fileName);
		if (fs.existsSync(reportPath)) {
			logger.info?.(`Found complexity report at: ${reportPath}`);
			return reportPath;
		}
	}

	logger.warn?.(`No complexity report found in project: ${projectRoot}`);
	return null;
}

/**
 * Find the configuration file path with fallback logic
 * @param {string|null} explicitPath - Explicit path provided by user (highest priority)
 * @param {Object|null} args - Args object for MCP context (optional)
 * @param {Object|null} log - Logger object (optional)
 * @returns {string|null} - Resolved config file path or null if not found
 */
export function findConfigPath(explicitPath = null, args = null, log = null) {
	const logger = getLoggerOrDefault(log);

	// 1. If explicit path is provided, use it (highest priority)
	if (explicitPath) {
		// Use original cwd if available (set by dev.js), otherwise current cwd
		const cwdForResolution =
			process.env.TASKGRAPH_ORIGINAL_CWD || process.cwd();

		const resolvedPath = path.isAbsolute(explicitPath)
			? explicitPath
			: path.resolve(cwdForResolution, explicitPath);

		if (fs.existsSync(resolvedPath)) {
			logger.info?.(`Using explicit config path: ${resolvedPath}`);
			return resolvedPath;
		} else {
			logger.warn?.(
				`Explicit config path not found: ${resolvedPath}, trying fallbacks`
			);
		}
	}

	// 2. Try to get project root from args (MCP) or find it
	const rawProjectRoot = args?.projectRoot || findProjectRoot();

	if (!rawProjectRoot) {
		logger.warn?.('Could not determine project root directory');
		return null;
	}

	// 3. Normalize project root to prevent double .taskgraph paths
	const projectRoot = normalizeProjectRoot(rawProjectRoot);

	// 4. Look for .taskgraph/config.json
	const configPath = path.join(projectRoot, TASKGRAPH_CONFIG_FILE);
	if (fs.existsSync(configPath)) {
		return configPath;
	}

	// Only warn once per command execution to prevent spam during init
	// Skip warning if the global suppress flag is set
	const shouldSkipWarning = isConfigWarningSuppressed();

	if (!shouldSkipWarning) {
		const warningKey = `config_warning_${projectRoot}`;

		if (!global._tmConfigWarningsThisRun) {
			global._tmConfigWarningsThisRun = new Set();
		}

		if (!global._tmConfigWarningsThisRun.has(warningKey)) {
			global._tmConfigWarningsThisRun.add(warningKey);
			// Debug only: config-manager tells the user, once
			logger.debug?.(`No configuration file found in project: ${projectRoot}`);
		}
	}

	return null;
}
