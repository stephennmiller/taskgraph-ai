import { defineConfig } from 'vitest/config';

/**
 * Root Vitest configuration for TaskGraph monorepo
 * Provides shared defaults for all packages
 * Individual packages can extend this config with package-specific settings
 */
export default defineConfig({
	test: {
		// Enable global test APIs (describe, it, expect, etc.)
		globals: true,

		// Default environment for all packages (Node.js)
		environment: 'node',

		// Common test file patterns
		include: [
			'tests/**/*.test.ts',
			'tests/**/*.spec.ts',
			'src/**/*.test.ts',
			'src/**/*.spec.ts'
		],

		// Common exclusions
		exclude: ['node_modules', 'dist', '.git', '.cache', '**/node_modules/**'],

		// Coverage is off for a plain `vitest run` (`npm run test -w <package>`),
		// so it passes when the tests pass. `npm run test:coverage` turns it on
		// with --coverage and enforces the thresholds below.
		coverage: {
			provider: 'v8',
			enabled: false,
			reporter: ['text', 'json', 'html'],
			include: ['src/**/*.ts'],
			exclude: [
				'node_modules/',
				'dist/',
				'tests/',
				'**/*.test.ts',
				'**/*.spec.ts',
				'**/*.d.ts',
				'**/mocks/**',
				'**/fixtures/**',
				'**/types/**',
				'vitest.config.ts',
				'src/index.ts'
			],
			// Default thresholds for test:coverage (can be overridden per package)
			thresholds: {
				branches: 70,
				functions: 70,
				lines: 70,
				statements: 70
			}
		},

		// Test execution settings
		testTimeout: 10000,
		clearMocks: true,
		restoreMocks: true,
		mockReset: true
	}
});
