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
 * Names in the list that are not supported rule profiles
 * @param {string[]} rulesProfiles - Profile names to check
 * @returns {string[]} The unsupported names, in input order
 */
export function findInvalidRulesProfiles(rulesProfiles) {
	return rulesProfiles.filter((name) => !isValidRulesProfile(name));
}

/**
 * Check if a given rule profile is valid
 * @param {string} rulesProfile - The rule profile to check
 * @returns {boolean} True if the rule profile is valid, false otherwise
 */
export function isValidRulesProfile(rulesProfile) {
	return RULE_PROFILES.includes(rulesProfile);
}
