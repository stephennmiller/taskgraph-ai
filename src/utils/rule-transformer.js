/**
 * Rule Transformer Module
 * Installs a rule profile (Claude Code) into a project: lifecycle hooks,
 * MCP configuration and slash commands.
 */
import path from 'path';
import { log } from '../../scripts/modules/utils.js';

// Import asset resolver
import { getAssetsDir } from './asset-resolver.js';

// Import the shared MCP configuration helper
import { setupMCPConfiguration } from './create-mcp-config.js';

// Import profile constants (single source of truth)
import { RULE_PROFILES } from '../constants/profiles.js';

// --- Profile Imports ---
import * as profilesModule from '../profiles/index.js';

export function isValidProfile(profile) {
	return RULE_PROFILES.includes(profile);
}

/**
 * Get rule profile by name
 * @param {string} name - Profile name
 * @returns {Object|null} Profile object or null if not found
 */
export function getRulesProfile(name) {
	if (!isValidProfile(name)) {
		return null;
	}

	// Get the profile from the imported profiles module
	const profileKey = `${name}Profile`;
	const profile = profilesModule[profileKey];

	if (!profile) {
		throw new Error(
			`Profile not found: static import missing for '${name}'. Valid profiles: ${RULE_PROFILES.join(', ')}`
		);
	}

	return profile;
}

/**
 * Install a profile into a project
 * @param {string} projectRoot - The project root directory
 * @param {Object} profile - The profile configuration
 * @returns {{success: number, failed: number}} Result counts
 */
export function convertAllRulesToProfileRules(projectRoot, profile) {
	const targetDir = path.join(projectRoot, profile.rulesDir);

	let failed = 0;

	// 1. Lifecycle hook for pre-processing (e.g. copying assets, CLAUDE.md import)
	if (typeof profile.onAddRulesProfile === 'function') {
		try {
			profile.onAddRulesProfile(targetDir, getAssetsDir());
			log(
				'debug',
				`[Rule Transformer] Called onAddRulesProfile for ${profile.profileName}`
			);
		} catch (error) {
			log(
				'error',
				`[Rule Transformer] onAddRulesProfile failed for ${profile.profileName}: ${error.message}`
			);
			failed++;
		}
	}

	// 2. Setup MCP configuration (if enabled)
	if (profile.mcpConfig !== false) {
		try {
			setupMCPConfiguration(projectRoot, profile.mcpConfigPath);
			log(
				'debug',
				`[Rule Transformer] Setup MCP configuration for ${profile.profileName}`
			);
		} catch (error) {
			log(
				'error',
				`[Rule Transformer] MCP setup failed for ${profile.profileName}: ${error.message}`
			);
		}
	}

	// 3. Post-conversion hook (for finalization)
	if (typeof profile.onPostConvertRulesProfile === 'function') {
		try {
			profile.onPostConvertRulesProfile(targetDir, getAssetsDir());
			log(
				'debug',
				`[Rule Transformer] Called onPostConvertRulesProfile for ${profile.profileName}`
			);
		} catch (error) {
			log(
				'error',
				`[Rule Transformer] onPostConvertRulesProfile failed for ${profile.profileName}: ${error.message}`
			);
		}
	}

	// 4. Add slash commands (if profile supports them)
	if (profile.slashCommands) {
		try {
			const result = profile.slashCommands.profile.addSlashCommands(
				projectRoot,
				profile.slashCommands.commands
			);
			if (result.success) {
				log(
					'debug',
					`[Rule Transformer] Created ${result.count} slash commands in ${result.directory}`
				);
			} else {
				log(
					'error',
					`[Rule Transformer] Failed to add slash commands for ${profile.profileName}: ${result.error}`
				);
			}
		} catch (error) {
			log(
				'error',
				`[Rule Transformer] Slash commands failed for ${profile.profileName}: ${error.message}`
			);
		}
	}

	// Profiles only use lifecycle functions, so report at least one success
	return { success: 1, failed };
}
