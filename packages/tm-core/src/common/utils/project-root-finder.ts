import fs from 'node:fs';
import path from 'node:path';
import {
	OTHER_PROJECT_MARKERS,
	PROJECT_BOUNDARY_MARKERS,
	TASKGRAPH_CONFIG_FILE,
	TASKGRAPH_PROJECT_MARKERS,
	TASKGRAPH_TASKS_FILE,
	TASKGRAPH_WORKTREES_DIR
} from '../constants/paths.js';
import { isWithin } from '../../modules/migration/import-paths.js';

function markerExists(dir: string, marker: string): boolean {
	try {
		return fs.existsSync(path.join(dir, marker));
	} catch {
		return false;
	}
}

function hasAnyMarker(dir: string, markers: readonly string[]): boolean {
	return markers.some((marker) => markerExists(dir, marker));
}

/**
 * Find the project root by traversing upward from startDir looking for project markers.
 *
 * Search strategy prevents false matches from stray .taskgraph dirs (e.g., in home):
 * 1. If startDir has .taskgraph or a boundary marker (.git, package.json), return immediately
 * 2. Search parents for .taskgraph anchored by a boundary marker (or 1 level up without boundary)
 * 3. Fall back to searching for other project markers (pyproject.toml, Cargo.toml, etc.)
 * 4. If nothing found, return startDir (supports `tm init` in empty directories)
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
	let currentDir = path.resolve(startDir);
	const rootDir = path.parse(currentDir).root;
	const maxDepth = 50;
	let depth = 0;
	let projectBoundaryDir: string | null = null;

	// Check startDir first - if it has .taskgraph or a boundary marker, we're done
	if (hasAnyMarker(currentDir, TASKGRAPH_PROJECT_MARKERS)) {
		return currentDir;
	}
	if (hasAnyMarker(currentDir, PROJECT_BOUNDARY_MARKERS)) {
		return currentDir;
	}

	// Search parent directories for .taskgraph
	let searchDir = path.dirname(currentDir);
	depth = 1;

	while (depth < maxDepth) {
		const hasTaskGraph = hasAnyMarker(searchDir, TASKGRAPH_PROJECT_MARKERS);
		const hasBoundary = hasAnyMarker(searchDir, PROJECT_BOUNDARY_MARKERS);

		if (hasTaskGraph) {
			// Accept .taskgraph if anchored by boundary or only 1 level up
			if (hasBoundary || depth === 1) {
				return searchDir;
			}
			// Distant .taskgraph without boundary is likely stray (e.g., home dir) - skip it
		}

		if (hasBoundary && !hasTaskGraph) {
			// Hit project boundary without .taskgraph - stop searching upward
			projectBoundaryDir = searchDir;
			break;
		}

		if (searchDir === rootDir) break;

		const parentDir = path.dirname(searchDir);
		if (parentDir === searchDir) break;

		searchDir = parentDir;
		depth++;
	}

	// No .taskgraph found - search for other project markers
	currentDir = projectBoundaryDir || path.resolve(startDir);
	depth = 0;

	while (depth < maxDepth) {
		if (hasAnyMarker(currentDir, OTHER_PROJECT_MARKERS)) {
			return currentDir;
		}

		if (currentDir === rootDir) break;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) break;

		currentDir = parentDir;
		depth++;
	}

	return path.resolve(startDir);
}

/**
 * The environment variable that names the project root. The MCP server reads
 * it too. `loop --parallel` sets it for each task's Claude Code process, so
 * `taskgraph` commands run in a task worktree record status and notes in the
 * main project rather than in the worktree's copy of tasks.json.
 */
export const PROJECT_ROOT_ENV = 'TASKGRAPH_PROJECT_ROOT';

/**
 * The project named by `explicit` (a `--project` flag or an MCP tool's
 * `projectRoot`) when given, else by TASKGRAPH_PROJECT_ROOT in the first of
 * `envs` that sets it, as an absolute path; undefined when neither names one.
 * Relative paths resolve against the current directory, and a blank variable
 * counts as unset. The CLI and both MCP servers use this order, so an explicit
 * path wins over the variable.
 *
 * One exception: an explicit path inside the variable's project's
 * `.taskgraph/worktrees` is a `loop --parallel` task worktree, and gives the
 * variable's project. MCP tools require `projectRoot`, so Claude Code in a
 * task worktree passes the worktree, and the task's status belongs in the
 * main project.
 */
export function namedProjectRoot(
	explicit?: string,
	...envs: Array<Record<string, string | undefined> | undefined>
): string | undefined {
	const fromEnv = envs
		.map((env) => env?.[PROJECT_ROOT_ENV]?.trim())
		.find(Boolean);
	const envRoot = fromEnv ? path.resolve(fromEnv) : undefined;
	if (!explicit) return envRoot;
	const root = path.resolve(explicit);
	return envRoot && isWithin(path.join(envRoot, TASKGRAPH_WORKTREES_DIR), root)
		? envRoot
		: root;
}

/**
 * The project a command works on, as an absolute path: the one
 * namedProjectRoot gives for `explicit` and `env`, else the root found from
 * the current directory (see findProjectRoot).
 */
export function resolveProjectRoot(
	explicit?: string,
	env: NodeJS.ProcessEnv = process.env
): string {
	return namedProjectRoot(explicit, env) ?? findProjectRoot();
}

/**
 * Whether `dir` holds a TaskGraph project, i.e. one that `taskgraph init` set
 * up. An empty `.taskgraph` folder doesn't count: older versions left one
 * behind when `list` or `next` ran in a folder that wasn't a project.
 */
export function isTaskGraphProject(dir: string): boolean {
	return (
		markerExists(dir, TASKGRAPH_CONFIG_FILE) ||
		markerExists(dir, TASKGRAPH_TASKS_FILE)
	);
}

/**
 * Strip .taskgraph (and anything after it) from a path.
 * Prevents double .taskgraph paths when combining with constants that include .taskgraph.
 */
export function normalizeProjectRoot(
	projectRoot: string | null | undefined
): string {
	if (!projectRoot) return '';

	const segments = String(projectRoot).split(path.sep);
	const taskgraphIndex = segments.findIndex((s) => s === '.taskgraph');

	if (taskgraphIndex !== -1) {
		return segments.slice(0, taskgraphIndex).join(path.sep) || path.sep;
	}

	return String(projectRoot);
}
