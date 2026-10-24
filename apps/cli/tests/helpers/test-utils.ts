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
 * Timeout for a test that starts the built CLI `spawns` times. One start takes
 * a few hundred ms on an idle machine but several seconds on a loaded one, so a
 * fixed 30 s fails tests that start it more than a few times (#422).
 *
 * @param spawns How many times the test starts the CLI
 * @returns Milliseconds to pass as the test's timeout
 */
export function spawnTimeout(spawns: number): number {
	return spawns * 15_000;
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
