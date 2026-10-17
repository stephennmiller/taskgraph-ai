/**
 * @typedef {'claude'} RulesProfile
 */

/**
 * Available rule profiles for project initialization
 *
 * Task Master supports Claude Code only. This is the single source of truth.
 *
 * @type {RulesProfile[]}
 */
export const RULE_PROFILES = ['claude'];

/**
 * Check if a given rule profile is valid
 * @param {string} rulesProfile - The rule profile to check
 * @returns {boolean} True if the rule profile is valid, false otherwise
 */
export function isValidRulesProfile(rulesProfile) {
	return RULE_PROFILES.includes(rulesProfile);
}
