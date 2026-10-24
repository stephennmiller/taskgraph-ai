import fs from 'fs';
import path from 'path';
import { resolvePathInsideRoot } from '@tm/core';
import {
	findComplexityReportPath as coreFindComplexityReportPath,
	findPRDPath as coreFindPrdPath,
	findTasksPath as coreFindTasksPath,
	resolveComplexityReportOutputPath as coreResolveComplexityReportOutputPath,
	normalizeProjectRoot
} from '../../../../src/utils/path-utils.js';

/**
 * MCP-specific path utilities that extend core path utilities with session support
 * This module handles session-specific path resolution for the MCP server
 */

/**
 * Resolve a path the model sent and refuse it when it leaves the project.
 * @param {string} projectRoot - Project directory
 * @param {string} candidate - Absolute path, or relative to projectRoot
 * @returns {string} Absolute path inside projectRoot
 * @throws {Error} When the path is outside projectRoot
 */
export function assertInsideRoot(projectRoot, candidate) {
	// A root that does not exist yet (before initialize_project) has no symlinks to follow
	let root = path.resolve(projectRoot);
	try {
		root = fs.realpathSync(projectRoot);
	} catch {}
	if (resolvePathInsideRoot(root, candidate) === null) {
		throw new Error(
			`Path '${candidate}' is outside the project root '${projectRoot}'`
		);
	}
	return path.resolve(projectRoot, candidate);
}

/**
 * Silent logger for MCP context to prevent console output
 */
const silentLogger = {
	info: () => {},
	warn: () => {},
	error: () => {},
	debug: () => {},
	success: () => {}
};

/**
 * Resolve tasks.json path from arguments
 * Prioritizes explicit path parameter, then uses fallback logic
 * @param {Object} args - Arguments object containing projectRoot and optional file path
 * @param {Object} [log] - Logger object to prevent console logging
 * @returns {string|null} - Resolved path to tasks.json or null if not found
 */
export function resolveTasksPath(args, log = silentLogger) {
	// Get explicit path from args.file if provided
	const explicitPath = args?.file;
	const rawProjectRoot = args?.projectRoot;

	// Without a project root there is nothing to check an absolute path against
	if (explicitPath && !rawProjectRoot && path.isAbsolute(explicitPath)) {
		throw new Error('projectRoot is required when a file path is absolute');
	}

	// Normalize project root if provided
	const projectRoot = rawProjectRoot
		? normalizeProjectRoot(rawProjectRoot)
		: null;

	// If explicit path is relative, resolve it relative to normalized projectRoot
	if (explicitPath && projectRoot) {
		return assertInsideRoot(projectRoot, explicitPath);
	}

	// Use core findTasksPath with explicit path and normalized projectRoot context
	if (projectRoot) {
		const foundPath = coreFindTasksPath(explicitPath, { projectRoot }, log);
		// If core function returns null and no explicit path was provided,
		// construct the expected default path as documented
		if (foundPath === null && !explicitPath) {
			const defaultPath = path.join(
				projectRoot,
				'.taskgraph',
				'tasks',
				'tasks.json'
			);
			log?.info?.(
				`Core findTasksPath returned null, using default path: ${defaultPath}`
			);
			return defaultPath;
		}
		return foundPath;
	}

	// Fallback to core function without projectRoot context
	const foundPath = coreFindTasksPath(explicitPath, null, log);
	// Note: When no projectRoot is available, we can't construct a default path
	// so we return null and let the calling code handle the error
	return foundPath;
}

/**
 * Resolve PRD path from arguments
 * @param {Object} args - Arguments object containing projectRoot and optional input path
 * @param {Object} [log] - Logger object to prevent console logging
 * @returns {string|null} - Resolved path to PRD file or null if not found
 */
export function resolvePrdPath(args, log = silentLogger) {
	// Get explicit path from args.input if provided
	const explicitPath = args?.input;
	const rawProjectRoot = args?.projectRoot;

	// Without a project root there is nothing to check an absolute path against
	if (explicitPath && !rawProjectRoot && path.isAbsolute(explicitPath)) {
		throw new Error('projectRoot is required when a file path is absolute');
	}

	// Normalize project root if provided
	const projectRoot = rawProjectRoot
		? normalizeProjectRoot(rawProjectRoot)
		: null;

	// If explicit path is relative, resolve it relative to normalized projectRoot
	if (explicitPath && projectRoot) {
		return assertInsideRoot(projectRoot, explicitPath);
	}

	// Use core findPRDPath with explicit path and normalized projectRoot context
	if (projectRoot) {
		return coreFindPrdPath(explicitPath, { projectRoot }, log);
	}

	// Fallback to core function without projectRoot context
	return coreFindPrdPath(explicitPath, null, log);
}

/**
 * Resolve complexity report path from arguments
 * @param {Object} args - Arguments object containing projectRoot and optional complexityReport path
 * @param {Object} [log] - Logger object to prevent console logging
 * @returns {string|null} - Resolved path to complexity report or null if not found
 */
export function resolveComplexityReportPath(args, log = silentLogger) {
	// Get explicit path from args.complexityReport if provided
	const explicitPath = args?.complexityReport;
	const rawProjectRoot = args?.projectRoot;
	const tag = args?.tag;

	// Without a project root there is nothing to check an absolute path against
	if (explicitPath && !rawProjectRoot && path.isAbsolute(explicitPath)) {
		throw new Error('projectRoot is required when a file path is absolute');
	}

	// Normalize project root if provided
	const projectRoot = rawProjectRoot
		? normalizeProjectRoot(rawProjectRoot)
		: null;

	// If explicit path is relative, resolve it relative to normalized projectRoot
	if (explicitPath && projectRoot) {
		return assertInsideRoot(projectRoot, explicitPath);
	}

	// Use core findComplexityReportPath with explicit path and normalized projectRoot context
	if (projectRoot) {
		return coreFindComplexityReportPath(
			explicitPath,
			{ projectRoot, tag },
			log
		);
	}

	// Fallback to core function without projectRoot context
	return coreFindComplexityReportPath(explicitPath, null, log);
}

/**
 * Resolve any project-relative path from arguments
 * @param {string} relativePath - Relative path to resolve
 * @param {Object} args - Arguments object containing projectRoot
 * @returns {string} - Resolved absolute path
 */
export function resolveProjectPath(relativePath, args) {
	// Ensure we have a projectRoot from args
	if (!args?.projectRoot) {
		throw new Error('projectRoot is required in args to resolve project paths');
	}

	// Normalize the project root to prevent double .taskgraph paths
	const projectRoot = normalizeProjectRoot(args.projectRoot);

	// If already absolute, return as-is
	if (path.isAbsolute(relativePath)) {
		return relativePath;
	}

	// Resolve relative to normalized projectRoot
	return path.resolve(projectRoot, relativePath);
}

// MAIN EXPORTS FOR MCP TOOLS - these are the functions MCP tools should use

/**
 * Find tasks.json path from arguments - primary MCP function
 * @param {Object} args - Arguments object containing projectRoot and optional file path
 * @param {Object} [log] - Log function to prevent console logging
 * @returns {string|null} - Resolved path to tasks.json or null if not found
 */
export function findTasksPath(args, log = silentLogger) {
	return resolveTasksPath(args, log);
}

/**
 * Find complexity report path from arguments - primary MCP function
 * @param {Object} args - Arguments object containing projectRoot and optional complexityReport path
 * @param {Object} [log] - Log function to prevent console logging
 * @returns {string|null} - Resolved path to complexity report or null if not found
 */
export function findComplexityReportPath(args, log = silentLogger) {
	return resolveComplexityReportPath(args, log);
}

/**
 * Resolve complexity report output path (create if needed) - primary MCP function
 * @param {string|null} [explicitPath] - Explicit path to complexity report
 * @param {Object} args - Arguments object containing projectRoot and tag
 * @param {Object} [log] - Log function to prevent console logging
 * @returns {string} - Resolved output path for complexity report
 */
export function resolveComplexityReportOutputPath(
	explicitPath,
	args,
	log = silentLogger
) {
	return coreResolveComplexityReportOutputPath(explicitPath, args, log);
}
