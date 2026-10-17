/**
 * Provider constants
 * TaskGraph supports a single AI provider: Claude Code.
 */

// Custom providers object for easy named access
export const CUSTOM_PROVIDERS = {
	CLAUDE_CODE: 'claude-code'
} as const;

export type CustomProvider =
	(typeof CUSTOM_PROVIDERS)[keyof typeof CUSTOM_PROVIDERS];

// Custom providers array (for backward compatibility and iteration)
export const CUSTOM_PROVIDERS_ARRAY = Object.values(CUSTOM_PROVIDERS);

// All known providers (for reference)
export const ALL_PROVIDERS = [...CUSTOM_PROVIDERS_ARRAY];
