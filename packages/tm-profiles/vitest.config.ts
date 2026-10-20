import { defineConfig } from 'vitest/config';

/**
 * Package-specific Vitest configuration for @tm/profiles
 * Covers the shell utilities and the plugin command files
 */
export default defineConfig({
	test: {
		globals: true,
		environment: 'node',
		include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'tests/**/*.test.ts'],
		exclude: ['node_modules', 'dist'],
		coverage: {
			provider: 'v8',
			enabled: true,
			reporter: ['text'],
			exclude: ['node_modules', 'dist'],
			thresholds: {
				branches: 70,
				functions: 80,
				lines: 80,
				statements: 80
			}
		}
	}
});
