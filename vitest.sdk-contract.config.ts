import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for tests/sdk-contract (Jest -> Vitest migration, #71/#78).
 * These tests are excluded from the default root run (vitest.root.config.ts)
 * and run in their own process, like the Jest `test:sdk-contract` script: the
 * real SDK stack leaves process-level state that breaks unrelated suites.
 *
 * Standalone (not mergeConfig) because merging would concatenate `include`
 * with the root config's globs and pull the whole root suite in.
 */
export default defineConfig({
	resolve: {
		alias: [{ find: /^@\/(.*)$/, replacement: `${rootDir}/$1` }]
	},
	test: {
		globals: true,
		environment: 'node',
		clearMocks: true,
		include: ['tests/sdk-contract/**/*.test.{js,ts}'],
		exclude: ['**/node_modules/**'],
		setupFiles: ['./tests/setup.js'],
		coverage: { enabled: false }
	}
});
