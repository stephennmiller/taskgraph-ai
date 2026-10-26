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
// file in .git/objects races a test deleting the repo (#713). Appended, so
// config the environment already passes this way still applies.
const gitConfigCount = Number(process.env.GIT_CONFIG_COUNT) || 0;
process.env[`GIT_CONFIG_KEY_${gitConfigCount}`] = 'maintenance.auto';
process.env[`GIT_CONFIG_VALUE_${gitConfigCount}`] = 'false';
process.env.GIT_CONFIG_COUNT = String(gitConfigCount + 1);

// Suppress console errors during tests unless explicitly testing them
const originalError = console.error;
beforeAll(() => {
	console.error = vi.fn();
});

afterAll(() => {
	console.error = originalError;
});
