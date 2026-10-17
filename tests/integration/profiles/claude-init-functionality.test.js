import fs from 'fs';
import path from 'path';
import {
	claudeProfile,
	transformToClaudeFormat
} from '../../../src/profiles/claude.js';

describe('Claude Profile Initialization Functionality', () => {
	let claudeProfileContent;

	beforeAll(() => {
		const claudeJsPath = path.join(
			process.cwd(),
			'src',
			'profiles',
			'claude.js'
		);
		claudeProfileContent = fs.readFileSync(claudeJsPath, 'utf8');
	});

	test('claude.js has correct asset-only profile configuration', () => {
		// Check for explicit, non-default values in the source file
		expect(claudeProfileContent).toContain("name: 'claude'");
		expect(claudeProfileContent).toContain("displayName: 'Claude Code'");
		expect(claudeProfileContent).toContain("profileDir: '.'"); // non-default
		expect(claudeProfileContent).toContain("rulesDir: '.'"); // non-default
		expect(claudeProfileContent).toContain("mcpConfigName: '.mcp.json'"); // non-default
		expect(claudeProfileContent).toContain(
			"'AGENTS.md': '.taskgraph/CLAUDE.md'"
		);

		// Check the final computed properties on the profile object
		expect(claudeProfile.profileName).toBe('claude');
		expect(claudeProfile.displayName).toBe('Claude Code');
		expect(claudeProfile.profileDir).toBe('.');
		expect(claudeProfile.rulesDir).toBe('.');
		expect(claudeProfile.mcpConfig).toBe(true); // default from base profile
		expect(claudeProfile.mcpConfigName).toBe('.mcp.json'); // explicitly set
		expect(claudeProfile.mcpConfigPath).toBe('.mcp.json'); // computed
		expect(claudeProfile.fileMap['AGENTS.md']).toBe('.taskgraph/CLAUDE.md');
	});

	test('claude.js has lifecycle functions for file management', () => {
		expect(claudeProfileContent).toContain('function onAddRulesProfile');
		expect(claudeProfileContent).toContain(
			'function onPostConvertRulesProfile'
		);
	});

	test('claude.js handles .claude directory and .taskgraph/CLAUDE.md import in lifecycle functions', () => {
		expect(claudeProfileContent).toContain('.claude');
		expect(claudeProfileContent).toContain('.taskgraph/CLAUDE.md');
		expect(claudeProfileContent).toContain('@./.taskgraph/CLAUDE.md');
	});

	test('claude.js has proper error handling in lifecycle functions', () => {
		expect(claudeProfileContent).toContain('try {');
		expect(claudeProfileContent).toContain('} catch (err) {');
		expect(claudeProfileContent).toMatch(/log\(\s*'error'/);
	});
});

describe('transformToClaudeFormat', () => {
	test('should add type: stdio to MCP server configs', () => {
		const input = {
			mcpServers: {
				'taskgraph-ai': {
					command: 'npx',
					args: ['-y', 'taskgraph-ai'],
					env: { ANTHROPIC_API_KEY: 'test-key' }
				}
			}
		};

		const result = transformToClaudeFormat(input);

		expect(result.mcpServers['taskgraph-ai']).toEqual({
			type: 'stdio',
			command: 'npx',
			args: ['-y', 'taskgraph-ai'],
			env: { ANTHROPIC_API_KEY: 'test-key' }
		});
	});

	test('should place type as first key in output', () => {
		const input = {
			mcpServers: {
				'my-server': {
					command: 'node',
					args: ['server.js']
				}
			}
		};

		const result = transformToClaudeFormat(input);
		const keys = Object.keys(result.mcpServers['my-server']);

		// type should be first key
		expect(keys[0]).toBe('type');
		expect(keys[1]).toBe('command');
		expect(keys[2]).toBe('args');
	});

	test('should handle multiple MCP servers', () => {
		const input = {
			mcpServers: {
				server1: { command: 'cmd1' },
				server2: { command: 'cmd2', args: ['arg1'] }
			}
		};

		const result = transformToClaudeFormat(input);

		expect(result.mcpServers.server1.type).toBe('stdio');
		expect(result.mcpServers.server2.type).toBe('stdio');
	});

	test('should preserve additional non-standard properties', () => {
		const input = {
			mcpServers: {
				'my-server': {
					command: 'node',
					customProperty: 'custom-value'
				}
			}
		};

		const result = transformToClaudeFormat(input);

		expect(result.mcpServers['my-server'].customProperty).toBe('custom-value');
	});

	test('should return empty object when input has no mcpServers', () => {
		const input = {};
		const result = transformToClaudeFormat(input);
		expect(result).toEqual({});
	});
});
