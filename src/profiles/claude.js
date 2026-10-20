import fs from 'fs';
// Claude Code profile for rule-transformer
import path from 'path';
import { log } from '../../scripts/modules/utils.js';
import { createProfile } from './base-profile.js';
import { enableDeferredMcpLoading } from '@tm/profiles';

// Lifecycle functions for Claude Code profile
function onAddRulesProfile(targetDir, assetsDir) {
	// Nothing is copied into .claude any more: commands and agents ship as a
	// Claude Code plugin, and init's summary says how to install it

	// Handle CLAUDE.md import for non-destructive integration
	const sourceFile = path.join(assetsDir, 'AGENTS.md');
	const userClaudeFile = path.join(targetDir, 'CLAUDE.md');
	const taskGraphClaudeFile = path.join(targetDir, '.taskgraph', 'CLAUDE.md');
	const importLine = '@./.taskgraph/CLAUDE.md';
	const importSection = `\n## TaskGraph Instructions\n**Import TaskGraph's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**\n${importLine}`;

	if (fs.existsSync(sourceFile)) {
		try {
			// Ensure .taskgraph directory exists
			const taskGraphDir = path.join(targetDir, '.taskgraph');
			if (!fs.existsSync(taskGraphDir)) {
				fs.mkdirSync(taskGraphDir, { recursive: true });
			}

			// Copy TaskGraph instructions to .taskgraph/CLAUDE.md
			fs.copyFileSync(sourceFile, taskGraphClaudeFile);
			log(
				'debug',
				`[Claude] Created TaskGraph instructions at ${taskGraphClaudeFile}`
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
						'debug',
						`[Claude] Added TaskGraph import to existing ${userClaudeFile}`
					);
				} else {
					log(
						'debug',
						`[Claude] TaskGraph import already present in ${userClaudeFile}`
					);
				}
			} else {
				// Create minimal CLAUDE.md with the import section
				const minimalContent = `# Claude Code Instructions\n${importSection}\n`;
				fs.writeFileSync(userClaudeFile, minimalContent);
				log(
					'debug',
					`[Claude] Created ${userClaudeFile} with TaskGraph import`
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
				'debug',
				`[Claude] Enabled deferred MCP loading in ${deferredResult.shellConfigFile}`
			);
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
		'AGENTS.md': '.taskgraph/CLAUDE.md'
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
