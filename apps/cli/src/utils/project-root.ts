/**
 * @fileoverview Project root utilities for CLI
 * Provides smart project root detection for command execution
 */

import { resolveProjectRoot } from '@tm/core';

/**
 * The project a command works on, always an absolute path:
 * 1. `projectPath` (the `--project` flag) when given, except that a path in
 *    TASKGRAPH_PROJECT_ROOT's `.taskgraph/worktrees` gives that project
 * 2. the TASKGRAPH_PROJECT_ROOT environment variable when set (`loop
 *    --parallel` sets it for each task's Claude Code process)
 * 3. the root found from the current directory: the nearest `.taskgraph`,
 *    `.git`, `package.json` or other project marker
 *
 * @param projectPath - Optional explicit project path from user
 */
export function getProjectRoot(projectPath?: string): string {
	return resolveProjectRoot(projectPath);
}
