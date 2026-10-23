/**
 * @fileoverview Shared test utilities for integration tests
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Get the absolute path to the compiled CLI binary
 *
 * IMPORTANT: This resolves to the root dist/ directory, not apps/cli/dist/
 * The CLI is built to <repo-root>/dist/taskgraph.js
 *
 * @returns Absolute path to taskgraph.js binary
 */
export function getCliBinPath(): string {
	// From apps/cli/tests/helpers/ navigate to repo root
	const repoRoot = path.resolve(__dirname, '../../../..');
	return path.join(repoRoot, 'dist', 'taskgraph.js');
}

/**
 * Copy a project set up once in beforeAll into a new temp folder, so each test
 * starts from the same files without spawning `init` (and any `add-task`)
 * again. Spawning the built CLI is the slow part of these tests.
 *
 * @param template Folder holding the prepared project
 * @param prefix Prefix for the new temp folder's name
 * @returns The new folder
 */
export function copyProject(template: string, prefix: string): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	fs.cpSync(template, dir, { recursive: true });
	return dir;
}
