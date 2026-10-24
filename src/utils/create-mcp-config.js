import fs from 'fs';
import path from 'path';
import { MCP_SERVER_KEY, launchesTaskGraphPackage } from '@tm/core';
import { log } from '../../scripts/modules/utils.js';

// Return JSON with existing mcp.json formatting style
function formatJSONWithTabs(obj) {
	let json = JSON.stringify(obj, null, '\t');

	json = json.replace(
		/(\[\n\t+)([^[\]]+?)(\n\t+\])/g,
		(match, openBracket, content, closeBracket) => {
			// Only convert to single line if content doesn't contain nested objects/arrays
			if (!content.includes('{') && !content.includes('[')) {
				const singleLineContent = content
					.replace(/\n\t+/g, ' ')
					.replace(/\s+/g, ' ')
					.trim();
				return `[${singleLineContent}]`;
			}
			return match;
		}
	);

	return json;
}

// Structure matches project conventions (see scripts/init.js)
export function setupMCPConfiguration(projectRoot, mcpConfigPath) {
	// Handle null mcpConfigPath (e.g., for Claude/Codex profiles)
	if (!mcpConfigPath) {
		log(
			'debug',
			'[MCP Config] No mcpConfigPath provided, skipping MCP configuration setup'
		);
		return;
	}

	// Build the full path to the MCP config file
	const mcpPath = path.join(projectRoot, mcpConfigPath);
	const configDir = path.dirname(mcpPath);

	log('debug', `Setting up MCP configuration at ${mcpPath}...`);

	// New MCP config to be added - references the installed package
	// TASKGRAPH_TOOLS: "core" loads essential daily workflow tools (7 tools, default)
	// Options: "core" (7 essential tools), "standard" (16 common tools), "all" (every tool)
	// See agent rules for tool tier details and how to upgrade if needed
	const newMCPServer = {
		[MCP_SERVER_KEY]: {
			command: 'npx',
			args: ['-y', MCP_SERVER_KEY],
			env: {
				TASKGRAPH_TOOLS: 'core'
			}
		}
	};

	// Create config directory if it doesn't exist
	if (!fs.existsSync(configDir)) {
		fs.mkdirSync(configDir, { recursive: true });
	}

	if (fs.existsSync(mcpPath)) {
		log(
			'debug',
			'MCP configuration file already exists, checking for existing taskgraph-ai...'
		);
		try {
			// Read existing config
			const mcpConfig = JSON.parse(fs.readFileSync(mcpPath, 'utf8'));
			// Initialize mcpServers if it doesn't exist
			if (!mcpConfig.mcpServers) {
				mcpConfig.mcpServers = {};
			}
			// Leave the config alone if any server already launches this package
			if (Object.values(mcpConfig.mcpServers).some(launchesTaskGraphPackage)) {
				log(
					'debug',
					'Found existing taskgraph-ai MCP configuration in mcp.json, leaving untouched'
				);
				return; // Exit early, don't modify the existing configuration
			}
			// Add the taskgraph-ai server if it doesn't exist
			if (!mcpConfig.mcpServers[MCP_SERVER_KEY]) {
				mcpConfig.mcpServers[MCP_SERVER_KEY] = newMCPServer[MCP_SERVER_KEY];
				log('debug', 'Added taskgraph-ai server to existing MCP configuration');
			} else {
				log('debug', 'taskgraph-ai server already configured in mcp.json');
			}
			// Write the updated configuration
			fs.writeFileSync(mcpPath, formatJSONWithTabs(mcpConfig) + '\n');
			log('debug', 'Updated MCP configuration file');
		} catch (error) {
			log('error', `Failed to update MCP configuration: ${error.message}`);
			// Create a backup before potentially modifying
			const backupPath = `${mcpPath}.backup-${Date.now()}`;
			if (fs.existsSync(mcpPath)) {
				fs.copyFileSync(mcpPath, backupPath);
				log('warn', `Saved the old file as ${backupPath}`);
			}
			// Create new configuration
			const newMCPConfig = {
				mcpServers: newMCPServer
			};
			fs.writeFileSync(mcpPath, formatJSONWithTabs(newMCPConfig) + '\n');
			log(
				'warn',
				'Created new MCP configuration file (backup of original file was created if it existed)'
			);
		}
	} else {
		// If mcp.json doesn't exist, create it
		const newMCPConfig = {
			mcpServers: newMCPServer
		};
		fs.writeFileSync(mcpPath, formatJSONWithTabs(newMCPConfig) + '\n');
		log('debug', `Created MCP configuration file at ${mcpPath}`);
	}

	log('debug', 'MCP server will use the installed taskgraph-ai package');
}
