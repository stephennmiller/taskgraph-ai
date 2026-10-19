import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vitest config for the legacy root tests/ suite (Jest -> Vitest migration, #71).
 * Runs alongside Jest; kept separate from vitest.config.ts so that config's
 * defaults (coverage, mockReset, ...) do not apply to this suite.
 *
 * Run a single file: npx vitest run -c vitest.root.config.ts <path>
 *
 * Note: jest.resolver.cjs rewrites relative `./x.js` imports to `./x.ts` when
 * the .js file is missing. Vite (as bundled with the Vitest version in use)
 * does this natively, including for .js importers, so no resolver plugin is
 * needed (verified with a throwaway .js test importing a .ts-only module).
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
		coverage: { enabled: false }
	}
});
