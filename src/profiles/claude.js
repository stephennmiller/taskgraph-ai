import fs from 'fs';
// Claude Code profile for rule-transformer
import path from 'path';
import { log } from '../../scripts/modules/utils.js';
import { createProfile } from './base-profile.js';
import { enableDeferredMcpLoading } from '@tm/profiles';

// Lifecycle functions for Claude Code profile
function onAddRulesProfile(targetDir, assetsDir) {
	// Note: Commands and agents are now distributed via Claude Code plugin
	// Legacy .claude directory copying has been deprecated
	log(
		'info',
		'[Claude] Commands and agents are now available via the Task Master plugin'
	);
	log('info', '[Claude] Install with: /plugin marketplace add taskmaster');
	log('info', '[Claude] Then: /plugin install taskmaster@taskmaster');

	// Handle CLAUDE.md import for non-destructive integration
	const sourceFile = path.join(assetsDir, 'AGENTS.md');
	const userClaudeFile = path.join(targetDir, 'CLAUDE.md');
	const taskMasterClaudeFile = path.join(targetDir, '.taskmaster', 'CLAUDE.md');
	const importLine = '@./.taskmaster/CLAUDE.md';
	const importSection = `\n## Task Master AI Instructions\n**Import Task Master's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**\n${importLine}`;

	if (fs.existsSync(sourceFile)) {
		try {
			// Ensure .taskmaster directory exists
			const taskMasterDir = path.join(targetDir, '.taskmaster');
			if (!fs.existsSync(taskMasterDir)) {
				fs.mkdirSync(taskMasterDir, { recursive: true });
			}

			// Copy Task Master instructions to .taskmaster/CLAUDE.md
			fs.copyFileSync(sourceFile, taskMasterClaudeFile);
			log(
				'debug',
				`[Claude] Created Task Master instructions at ${taskMasterClaudeFile}`
			);

			// Handle user's CLAUDE.md
			if (fs.existsSync(userClaudeFile)) {
				// Check if import already exists
				const content = fs.readFileSync(userClaudeFile, 'utf8');
				if (!content.includes(importLine)) {
					// Append import section at the end
					const updatedContent = content.trim() + '\n' + importSection + '\n';
					fs.writeFileSync(userClaudeFile, updatedContent);
					log(
						'info',
						`[Claude] Added Task Master import to existing ${userClaudeFile}`
					);
				} else {
					log(
						'info',
						`[Claude] Task Master import already present in ${userClaudeFile}`
					);
				}
			} else {
				// Create minimal CLAUDE.md with the import section
				const minimalContent = `# Claude Code Instructions\n${importSection}\n`;
				fs.writeFileSync(userClaudeFile, minimalContent);
				log(
					'info',
					`[Claude] Created ${userClaudeFile} with Task Master import`
				);
			}
		} catch (err) {
			log(
				'error',
				`[Claude] Failed to set up Claude instructions: ${err.message}`
			);
		}
	}

	// Enable deferred MCP loading for reduced context usage
	const deferredResult = enableDeferredMcpLoading();
	if (deferredResult.success) {
		if (deferredResult.alreadyExists) {
			log('debug', '[Claude] Deferred MCP loading already configured');
		} else {
			log(
				'info',
				`[Claude] Enabled deferred MCP loading in ${deferredResult.shellConfigFile}`
			);
			log('info', '[Claude] Restart your terminal for changes to take effect');
		}
	} else {
		log(
			'debug',
			`[Claude] Could not configure deferred loading: ${deferredResult.message}`
		);
	}
}

/**
 * Transform standard MCP config format to Claude format
 * @param {Object} mcpConfig - Standard MCP configuration object
 * @returns {Object} - Transformed Claude configuration object
 */
function transformToClaudeFormat(mcpConfig) {
	const claudeConfig = {};

	// Transform mcpServers to servers (keeping the same structure but adding type)
	if (mcpConfig.mcpServers) {
		claudeConfig.mcpServers = {};

		for (const [serverName, serverConfig] of Object.entries(
			mcpConfig.mcpServers
		)) {
			// Transform server configuration with type as first key
			const reorderedServer = {};

			// Add type: "stdio" as the first key
			reorderedServer.type = 'stdio';

			// Then add the rest of the properties in order
			if (serverConfig.command) reorderedServer.command = serverConfig.command;
			if (serverConfig.args) reorderedServer.args = serverConfig.args;
			if (serverConfig.env) reorderedServer.env = serverConfig.env;

			// Add any other properties that might exist
			Object.keys(serverConfig).forEach((key) => {
				if (!['command', 'args', 'env', 'type'].includes(key)) {
					reorderedServer[key] = serverConfig[key];
				}
			});

			claudeConfig.mcpServers[serverName] = reorderedServer;
		}
	}

	return claudeConfig;
}

function onPostConvertRulesProfile(targetDir, assetsDir) {
	// onAddRulesProfile already ran before this hook; only the MCP config needs converting
	// Transform MCP configuration to Claude format
	const mcpConfigPath = path.join(targetDir, '.mcp.json');
	if (fs.existsSync(mcpConfigPath)) {
		try {
			const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
			const claudeConfig = transformToClaudeFormat(mcpConfig);

			// Write back the transformed configuration
			fs.writeFileSync(
				mcpConfigPath,
				JSON.stringify(claudeConfig, null, '\t') + '\n'
			);
			log(
				'debug',
				`[Claude] Transformed MCP configuration to Claude format at ${mcpConfigPath}`
			);
		} catch (err) {
			log(
				'error',
				`[Claude] Failed to transform MCP configuration: ${err.message}`
			);
		}
	}
}

// Create and export claude profile using the base factory
export const claudeProfile = createProfile({
	name: 'claude',
	displayName: 'Claude Code',
	profileDir: '.', // Root directory
	rulesDir: '.', // No specific rules directory needed
	mcpConfigName: '.mcp.json', // Place MCP config in project root
	fileMap: {
		'AGENTS.md': '.taskmaster/CLAUDE.md'
	},
	onAdd: onAddRulesProfile,
	onPostConvert: onPostConvertRulesProfile
});

// Export lifecycle functions separately to avoid naming conflicts
export {
	onAddRulesProfile,
	onPostConvertRulesProfile,
	transformToClaudeFormat
};
