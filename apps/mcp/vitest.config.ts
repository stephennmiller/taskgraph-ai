import { defineConfig, mergeConfig } from 'vitest/config';
import rootConfig from '../../vitest.config';

/**
 * MCP package Vitest configuration
 * Extends root config with MCP-specific settings
 */
export default mergeConfig(
	rootConfig,
	defineConfig({
		test: {
			// MCP-specific test patterns
			include: [
				'tests/**/*.test.ts',
				'tests/**/*.spec.ts',
				'src/**/*.test.ts',
				'src/**/*.spec.ts'
			],
			// Integration tests run `taskgraph init` in beforeEach and spawn the
			// built server; on a busy CI runner that can take longer than the
			// default 10s, as the CLI package already allows for
			testTimeout: 30000,
			hookTimeout: 30000
		}
	})
);
