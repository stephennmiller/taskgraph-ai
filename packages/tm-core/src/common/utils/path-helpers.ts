/**
 * @fileoverview Path construction utilities for TaskGraph
 * Provides standardized paths for TaskGraph project structure
 */

import { join } from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '../constants/paths.js';
import { resolveProjectRoot } from './project-root-finder.js';

/**
 * Get standard TaskGraph project paths
 * Automatically detects project root using smart detection
 *
 * @param projectPath - Optional explicit project path (if not provided, auto-detects)
 * @returns Object with projectRoot and tasksPath
 *
 * @example
 * ```typescript
 * // Auto-detect project root
 * const { projectRoot, tasksPath } = getProjectPaths();
 *
 * // Or specify explicit path
 * const { projectRoot, tasksPath } = getProjectPaths('./my-project');
 * // projectRoot: '/absolute/path/to/my-project'
 * // tasksPath: '/absolute/path/to/my-project/.taskgraph/tasks/tasks.json'
 * ```
 */
export function getProjectPaths(projectPath?: string): {
	projectRoot: string;
	tasksPath: string;
} {
	// An explicit path, else TASKGRAPH_PROJECT_ROOT, else the one found
	const projectRoot = resolveProjectRoot(projectPath);

	return {
		projectRoot,
		tasksPath: join(projectRoot, TASKGRAPH_TASKS_FILE)
	};
}
