/**
 * Base tsdown configuration for TaskGraph monorepo
 * Provides shared configuration that can be extended by individual packages
 */
import type { UserConfig } from 'tsdown';

const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = !isProduction;

/**
 * Environment helpers
 */
export const env = {
	isProduction,
	isDevelopment,
	NODE_ENV: process.env.NODE_ENV || 'development'
};

/**
 * Base tsdown configuration for all packages
 * Since everything gets bundled into root dist/ anyway, use consistent settings
 */
export const baseConfig: Partial<UserConfig> = {
	sourcemap: isDevelopment,
	format: 'esm',
	platform: 'node',
	// Nothing consumes declarations for these plain JS entries (the emitted .d.ts
	// were empty stubs). Emit also fails on ai-providers/base-provider.js: TS 5.9
	// reports TS9006 and TS 7 TS4053 (private name PartialObject from `ai`), and
	// rolldown-plugin-dts switches to the tsgo binary on TS 7 and fails hard.
	dts: false,
	minify: isProduction,
	treeshake: isProduction,
	// Better debugging in development
	...(isDevelopment && {
		keepNames: true,
		splitting: false // Disable code splitting for better stack traces
	}),
	// Bundle our workspace packages and date-fns; keep other npm dependencies
	// external (available via node_modules). date-fns's index loads ~300
	// files, which took 0.9 s on every command; bundled, only the two
	// functions @tm/core uses remain (#248). Rolldown also tests resolved file
	// paths here; on Windows they start with a drive letter (D:\...), which
	// must not count as a bare package name.
	deps: {
		neverBundle: [/^(?![a-zA-Z]:[\\/]|date-fns(\/|$))[^@./]/, /^@(?!tm\/)/],
		alwaysBundle: [/^@tm\//, /^date-fns(\/|$)/],
		onlyBundle: [/^date-fns(\/|$)/]
	}
};

/**
 * Utility function to merge configurations
 * Simplified for tsdown usage
 */
export function mergeConfig(
	base: Partial<UserConfig>,
	overrides: Partial<UserConfig>
): UserConfig {
	return {
		...base,
		...overrides
	} as UserConfig;
}
