import fs from 'fs';
import os from 'os';
import path from 'path';
import { jest } from '@jest/globals';

// Mock external modules
jest.mock('child_process', () => ({
	execSync: jest.fn()
}));

jest.mock('readline', () => ({
	createInterface: jest.fn(() => ({
		question: jest.fn(),
		close: jest.fn()
	}))
}));

// Mock figlet for banner display
jest.mock('figlet', () => ({
	default: {
		textSync: jest.fn(() => 'TaskGraph')
	}
}));

// Mock console methods
jest.mock('console', () => ({
	log: jest.fn(),
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	clear: jest.fn()
}));

describe('MCP Configuration Handling', () => {
	let tempDir;

	beforeEach(() => {
		jest.clearAllMocks();

		// Create a temporary directory for testing
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-test-'));

		// Spy on fs methods
		jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
		jest.spyOn(fs, 'readFileSync').mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return JSON.stringify({
					mcpServers: {
						'existing-server': {
							command: 'node',
							args: ['server.js']
						}
					}
				});
			}
			return '{}';
		});
		jest.spyOn(fs, 'existsSync').mockImplementation((filePath) => {
			// Return true for specific paths to test different scenarios
			if (filePath.toString().includes('package.json')) {
				return true;
			}
			// Default to false for other paths
			return false;
		});
		jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
		jest.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
	});

	afterEach(() => {
		// Clean up the temporary directory
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch (err) {
			console.error(`Error cleaning up: ${err.message}`);
		}
	});

	// Test function that simulates the behavior of setupMCPConfiguration
	function mockSetupMCPConfiguration(targetDir, projectName) {
		const mcpDirPath = path.join(targetDir, '.cursor');
		const mcpJsonPath = path.join(mcpDirPath, 'mcp.json');

		// Create .cursor directory if it doesn't exist
		if (!fs.existsSync(mcpDirPath)) {
			fs.mkdirSync(mcpDirPath, { recursive: true });
		}

		// New MCP config to be added - references the installed package
		const newMCPServer = {
			'taskgraph-ai': {
				command: 'npx',
				args: ['taskgraph-ai', 'mcp-server']
			}
		};

		// Check if mcp.json already exists
		if (fs.existsSync(mcpJsonPath)) {
			try {
				// Read existing config
				const mcpConfig = JSON.parse(fs.readFileSync(mcpJsonPath, 'utf8'));

				// Initialize mcpServers if it doesn't exist
				if (!mcpConfig.mcpServers) {
					mcpConfig.mcpServers = {};
				}

				// Add the taskgraph-ai server if it doesn't exist
				if (!mcpConfig.mcpServers['taskgraph-ai']) {
					mcpConfig.mcpServers['taskgraph-ai'] = newMCPServer['taskgraph-ai'];
				}

				// Write the updated configuration
				fs.writeFileSync(mcpJsonPath, JSON.stringify(mcpConfig, null, 4));
			} catch (error) {
				// Create new configuration on error
				const newMCPConfig = {
					mcpServers: newMCPServer
				};

				fs.writeFileSync(mcpJsonPath, JSON.stringify(newMCPConfig, null, 4));
			}
		} else {
			// If mcp.json doesn't exist, create it
			const newMCPConfig = {
				mcpServers: newMCPServer
			};

			fs.writeFileSync(mcpJsonPath, JSON.stringify(newMCPConfig, null, 4));
		}
	}

	test('creates mcp.json when it does not exist', () => {
		// Arrange
		const mcpJsonPath = path.join(tempDir, '.cursor', 'mcp.json');

		// Act
		mockSetupMCPConfiguration(tempDir, 'test-project');

		// Assert
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('taskgraph-ai')
		);

		// Should create a proper structure with mcpServers key
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('mcpServers')
		);

		// Should reference npx command
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('npx')
		);
	});

	test('updates existing mcp.json by adding new server', () => {
		// Arrange
		const mcpJsonPath = path.join(tempDir, '.cursor', 'mcp.json');

		// Override the existsSync mock to simulate mcp.json exists
		fs.existsSync.mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return true;
			}
			return false;
		});

		// Act
		mockSetupMCPConfiguration(tempDir, 'test-project');

		// Assert
		// Should preserve existing server
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('existing-server')
		);

		// Should add our new server
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('taskgraph-ai')
		);
	});

	test('handles JSON parsing errors by creating new mcp.json', () => {
		// Arrange
		const mcpJsonPath = path.join(tempDir, '.cursor', 'mcp.json');

		// Override existsSync to say mcp.json exists
		fs.existsSync.mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return true;
			}
			return false;
		});

		// But make readFileSync return invalid JSON
		fs.readFileSync.mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return '{invalid json';
			}
			return '{}';
		});

		// Act
		mockSetupMCPConfiguration(tempDir, 'test-project');

		// Assert
		// Should create a new valid JSON file with our server
		expect(fs.writeFileSync).toHaveBeenCalledWith(
			mcpJsonPath,
			expect.stringContaining('taskgraph-ai')
		);
	});

	test('does not modify existing server configuration if it already exists', () => {
		// Arrange
		const mcpJsonPath = path.join(tempDir, '.cursor', 'mcp.json');

		// Override existsSync to say mcp.json exists
		fs.existsSync.mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return true;
			}
			return false;
		});

		// Return JSON that already has taskgraph-ai
		fs.readFileSync.mockImplementation((filePath) => {
			if (filePath.toString().includes('mcp.json')) {
				return JSON.stringify({
					mcpServers: {
						'existing-server': {
							command: 'node',
							args: ['server.js']
						},
						'taskgraph-ai': {
							command: 'custom',
							args: ['custom-args']
						}
					}
				});
			}
			return '{}';
		});

		// Spy to check what's written
		const writeFileSyncSpy = jest.spyOn(fs, 'writeFileSync');

		// Act
		mockSetupMCPConfiguration(tempDir, 'test-project');

		// Assert
		// Verify the written data contains the original taskgraph configuration
		const dataWritten = JSON.parse(writeFileSyncSpy.mock.calls[0][1]);
		expect(dataWritten.mcpServers['taskgraph-ai'].command).toBe('custom');
		expect(dataWritten.mcpServers['taskgraph-ai'].args).toContain(
			'custom-args'
		);
	});

	test('creates the .cursor directory if it doesnt exist', () => {
		// Arrange
		const cursorDirPath = path.join(tempDir, '.cursor');

		// Make sure it looks like the directory doesn't exist
		fs.existsSync.mockReturnValue(false);

		// Act
		mockSetupMCPConfiguration(tempDir, 'test-project');

		// Assert
		expect(fs.mkdirSync).toHaveBeenCalledWith(cursorDirPath, {
			recursive: true
		});
	});
});
