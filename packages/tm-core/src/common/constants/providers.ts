/**
 * Provider validation constants
 * Task Master supports a single AI provider: Claude Code.
 */

// Providers that have predefined model lists and should be validated
export const VALIDATED_PROVIDERS = [] as const;

export type ValidatedProvider = (typeof VALIDATED_PROVIDERS)[number];

// Custom providers object for easy named access
export const CUSTOM_PROVIDERS = {
	CLAUDE_CODE: 'claude-code'
} as const;

export type CustomProvider =
	(typeof CUSTOM_PROVIDERS)[keyof typeof CUSTOM_PROVIDERS];

// Custom providers array (for backward compatibility and iteration)
export const CUSTOM_PROVIDERS_ARRAY = Object.values(CUSTOM_PROVIDERS);

// All known providers (for reference)
export const ALL_PROVIDERS = [
	...new Set([...VALIDATED_PROVIDERS, ...CUSTOM_PROVIDERS_ARRAY])
];
