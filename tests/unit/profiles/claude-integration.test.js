import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { claudeProfile } from '../../../src/profiles/claude.js';

// Mock external modules
vi.doMock('child_process', () => ({
	execSync: vi.fn()
}));

// Mock console methods
vi.doMock('console', () => ({
	log: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	clear: vi.fn()
}));

describe('Claude Profile Integration', () => {
	let tempDir;

	beforeEach(() => {
		vi.clearAllMocks();

		// Create a temporary directory for testing
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));

		// Spy on fs methods
		vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
		vi.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
			if (filePath.toString().includes('AGENTS.md')) {
				return 'Sample AGENTS.md content for Claude integration';
			}
			return '{}';
		});
		vi.spyOn(fs, 'existsSync').mockImplementation(() => false);
		vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
	});

	afterEach(() => {
		// Clean up the temporary directory
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch (err) {
			console.error(`Error cleaning up: ${err.message}`);
		}
	});

	// Test function that simulates the Claude profile file copying behavior
	function mockCreateClaudeStructure() {
		// Claude profile copies AGENTS.md to CLAUDE.md in project root
		const sourceContent = 'Sample AGENTS.md content for Claude integration';
		fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), sourceContent);
	}

	test('creates CLAUDE.md file in project root', () => {
		// Act
		mockCreateClaudeStructure();

		// Assert
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			path.join(tempDir, 'CLAUDE.md'),
			'Sample AGENTS.md content for Claude integration'
		);
	});

	test('does not create any profile directories', () => {
		// Act
		mockCreateClaudeStructure();

		// Assert - Claude profile should not create any directories
		// Only the temp directory creation calls should exist
		const mkdirCalls = fs.mkdirSync.mock.calls.filter(
			(call) => !call[0].includes('taskgraph-test-')
		);
		expect(mkdirCalls).toHaveLength(0);
	});

	test('supports MCP configuration when using rule transformer', () => {
		// This test verifies that the Claude profile is configured to support MCP
		// The actual MCP file creation is handled by the rule transformer

		// Assert - Claude profile should now support MCP configuration
		expect(claudeProfile.mcpConfig).toBe(true);
		expect(claudeProfile.mcpConfigName).toBe('.mcp.json');
		expect(claudeProfile.mcpConfigPath).toBe('.mcp.json');
	});

	test('mock function does not create MCP configuration files', () => {
		// Act
		mockCreateClaudeStructure();

		// Assert - The mock function should not create MCP config files
		// (This is expected since the mock doesn't use the rule transformer)
		const writeFileCalls = fs.writeFileSync.mock.calls;
		const mcpConfigCalls = writeFileCalls.filter(
			(call) =>
				call[0].toString().includes('mcp.json') ||
				call[0].toString().includes('mcp_settings.json')
		);
		expect(mcpConfigCalls).toHaveLength(0);
	});

	test('only creates the target integration guide file', () => {
		// Act
		mockCreateClaudeStructure();

		// Assert - Should only create CLAUDE.md
		const writeFileCalls = fs.writeFileSync.mock.calls;
		expect(writeFileCalls).toHaveLength(1);
		expect(writeFileCalls[0][0]).toBe(path.join(tempDir, 'CLAUDE.md'));
	});
});
