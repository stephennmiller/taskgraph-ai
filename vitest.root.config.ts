import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for the legacy root tests/ suite. Kept separate from
 * vitest.config.ts so that config's defaults (coverage, mockReset, ...) do not
 * apply to this suite. Coverage is off by default; `npm run test:coverage`
 * turns it on with --coverage.
 *
 * Run a single file: npx vitest run -c vitest.root.config.ts <path>
 *
 * Vite resolves relative `./x.js` imports to `./x.ts` when the .js file is
 * missing, including from .js importers, so no resolver plugin is needed.
 */
export default defineConfig({
	resolve: {
		alias: [{ find: /^@\/(.*)$/, replacement: `${rootDir}/$1` }]
	},
	test: {
		globals: true,
		environment: 'node',
		clearMocks: true,
		include: ['tests/**/*.test.{js,ts}', 'tests/**/*.spec.{js,ts}'],
		exclude: [
			'**/node_modules/**',
			'tests/sdk-contract/**',
			'tests/e2e/**',
			'tests/manual/**'
		],
		setupFiles: ['./tests/setup.js'],
		coverage: {
			enabled: false,
			reporter: ['text', 'lcov'],
			reportsDirectory: 'coverage'
		}
	}
});
