/**
 * @fileoverview Vitest test setup file
 */

import os from 'node:os';
import { afterAll, beforeAll, vi } from 'vitest';

// Git the tests run ignores the machine's config: a global commit.gpgsign
// runs a signing program on every commit, which timed tests out (#728).
process.env.GIT_CONFIG_GLOBAL = os.devNull;
process.env.GIT_CONFIG_NOSYSTEM = '1';
// No auto maintenance after a commit: newer git runs it detached, and its lock
// file in .git/objects races a test deleting .git; Node 24's rmSync can then
// return without error with .git still there (#713).
process.env.GIT_CONFIG_COUNT = '1';
process.env.GIT_CONFIG_KEY_0 = 'maintenance.auto';
process.env.GIT_CONFIG_VALUE_0 = 'false';

// Suppress console errors during tests unless explicitly testing them
const originalError = console.error;
beforeAll(() => {
	console.error = vi.fn();
});

afterAll(() => {
	console.error = originalError;
});
