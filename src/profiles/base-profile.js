// Base profile factory for rule-transformer
import path from 'path';
import { getProfile, allCommands } from '@tm/profiles';
import { log } from '../../scripts/modules/utils.js';

/**
 * Creates a standardized profile configuration
 * @param {Object} editorConfig - Profile-specific configuration
 * @param {string} editorConfig.name - Profile name (e.g., 'claude')
 * @param {string} [editorConfig.displayName] - Display name (defaults to name)
 * @param {string} editorConfig.profileDir - Directory for profile configuration
 * @param {string} [editorConfig.rulesDir] - Directory for rules files (defaults to profileDir/rules)
 * @param {boolean} [editorConfig.mcpConfig=true] - Whether to create MCP configuration
 * @param {string} [editorConfig.mcpConfigName='mcp.json'] - Name of MCP config file
 * @param {Object} [editorConfig.fileMap={}] - Asset files the profile manages (source asset -> target path)
 * @param {Function} [editorConfig.onAdd] - Lifecycle hook for profile addition
 * @param {Function} [editorConfig.onRemove] - Lifecycle hook for profile removal
 * @param {Function} [editorConfig.onPostConvert] - Lifecycle hook for post-conversion
 * @returns {Object} - Complete profile configuration
 */
export function createProfile(editorConfig) {
	const {
		name,
		displayName = name,
		profileDir = `.${name.toLowerCase()}`,
		rulesDir = `${profileDir}/rules`,
		mcpConfig = true,
		mcpConfigName = mcpConfig ? 'mcp.json' : null,
		fileMap = {},
		onAdd,
		onRemove,
		onPostConvert
	} = editorConfig;

	const mcpConfigPath = mcpConfigName
		? path.join(profileDir, mcpConfigName)
		: null;

	// Auto-detect slash command support from @tm/profiles
	let slashCommands = null;
	try {
		const slashCommandProfile = getProfile(name);
		if (slashCommandProfile?.supportsCommands) {
			slashCommands = {
				profile: slashCommandProfile,
				commands: allCommands
			};
		}
	} catch (err) {
		log(
			'debug',
			`[${displayName}] Slash command profile lookup failed: ${err.message}`
		);
	}

	return {
		profileName: name, // Use name for programmatic access (tests expect this)
		displayName: displayName, // Keep displayName for UI purposes
		profileDir,
		rulesDir,
		mcpConfig,
		mcpConfigName,
		mcpConfigPath,
		fileMap,
		// Declarative slash command config - rule-transformer handles execution
		slashCommands,
		// Optional lifecycle hooks
		...(onAdd && { onAddRulesProfile: onAdd }),
		...(onRemove && { onRemoveRulesProfile: onRemove }),
		...(onPostConvert && { onPostConvertRulesProfile: onPostConvert })
	};
}
