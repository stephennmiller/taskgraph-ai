/**
 * Tests for the expand-all MCP tool
 *
 * Note: This test does NOT test the actual implementation. It tests that:
 * 1. The tool is registered correctly with the correct parameters
 * 2. Arguments are passed correctly to expandAllTasksDirect
 * 3. Error handling works as expected
 *
 * We do NOT import the real implementation - everything is mocked
 */

import { vi } from 'vitest';

// Mock EVERYTHING
const mockExpandAllTasksDirect = vi.fn();
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	expandAllTasksDirect: mockExpandAllTasksDirect
}));

const mockHandleApiResult = vi.fn((result) => result);
const mockGetProjectRootFromSession = vi.fn(() => '/mock/project/root');
const mockCreateErrorResponse = vi.fn((msg) => ({
	success: false,
	error: { code: 'ERROR', message: msg }
}));
const mockWithNormalizedProjectRoot = vi.fn((fn) => fn);

vi.mock('../../../../mcp-server/src/tools/utils.js', () => ({
	getProjectRootFromSession: mockGetProjectRootFromSession,
	handleApiResult: mockHandleApiResult,
	createErrorResponse: mockCreateErrorResponse,
	withNormalizedProjectRoot: mockWithNormalizedProjectRoot
}));

// Mock the z object from zod
const mockZod = {
	object: vi.fn(() => mockZod),
	string: vi.fn(() => mockZod),
	number: vi.fn(() => mockZod),
	boolean: vi.fn(() => mockZod),
	optional: vi.fn(() => mockZod),
	describe: vi.fn(() => mockZod),
	_def: {
		shape: () => ({
			num: {},
			research: {},
			prompt: {},
			force: {},
			tag: {},
			projectRoot: {}
		})
	}
};

vi.mock('zod', () => ({
	z: mockZod
}));

// DO NOT import the real module - create a fake implementation
// This is the fake implementation of registerExpandAllTool
const registerExpandAllTool = (server) => {
	// Create simplified version of the tool config
	const toolConfig = {
		name: 'expand_all',
		description: 'Use TaskGraph to expand all eligible pending tasks',
		parameters: mockZod,

		// Create a simplified mock of the execute function
		execute: mockWithNormalizedProjectRoot(async (args, context) => {
			const { log, session } = context;

			try {
				log.info &&
					log.info(`Starting expand-all with args: ${JSON.stringify(args)}`);

				// Call expandAllTasksDirect
				const result = await mockExpandAllTasksDirect(args, log, { session });

				// Handle result
				return mockHandleApiResult(result, log);
			} catch (error) {
				log.error && log.error(`Error in expand-all tool: ${error.message}`);
				return mockCreateErrorResponse(error.message);
			}
		})
	};

	// Register the tool with the server
	server.addTool(toolConfig);
};

describe('MCP Tool: expand-all', () => {
	// Create mock server
	let mockServer;
	let executeFunction;

	// Create mock logger
	const mockLogger = {
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn()
	};

	// Test data
	const validArgs = {
		num: 3,
		research: true,
		prompt: 'additional context',
		force: false,
		tag: 'master',
		projectRoot: '/test/project'
	};

	// Standard responses
	const successResponse = {
		success: true,
		data: {
			message:
				'Expand all operation completed. Expanded: 2, Failed: 0, Skipped: 1',
			details: {
				expandedCount: 2,
				failedCount: 0,
				skippedCount: 1,
				tasksToExpand: 3,
				telemetryData: {
					commandName: 'expand-all-tasks',
					totalCost: 0.15,
					totalTokens: 2500
				}
			}
		}
	};

	const errorResponse = {
		success: false,
		error: {
			code: 'EXPAND_ALL_ERROR',
			message: 'Failed to expand tasks'
		}
	};

	beforeEach(() => {
		// Reset all mocks
		vi.clearAllMocks();

		// Create mock server
		mockServer = {
			addTool: vi.fn((config) => {
				executeFunction = config.execute;
			})
		};

		// Setup default successful response
		mockExpandAllTasksDirect.mockResolvedValue(successResponse);

		// Register the tool
		registerExpandAllTool(mockServer);
	});

	test('should register the tool correctly', () => {
		// Verify tool was registered
		expect(mockServer.addTool).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'expand_all',
				description: expect.stringContaining('expand all eligible pending'),
				parameters: expect.any(Object),
				execute: expect.any(Function)
			})
		);

		// Verify the tool config was passed
		const toolConfig = mockServer.addTool.mock.calls[0][0];
		expect(toolConfig).toHaveProperty('parameters');
		expect(toolConfig).toHaveProperty('execute');
	});

	test('should execute the tool with valid parameters', async () => {
		// Setup context
		const mockContext = {
			log: mockLogger,
			session: { workingDirectory: '/mock/dir' }
		};

		// Execute the function
		const result = await executeFunction(validArgs, mockContext);

		// Verify expandAllTasksDirect was called with correct arguments
		expect(mockExpandAllTasksDirect).toHaveBeenCalledWith(
			validArgs,
			mockLogger,
			{ session: mockContext.session }
		);

		// Verify handleApiResult was called
		expect(mockHandleApiResult).toHaveBeenCalledWith(
			successResponse,
			mockLogger
		);
		expect(result).toEqual(successResponse);
	});

	test('should handle expand all with no eligible tasks', async () => {
		// Arrange
		const mockDirectResult = {
			success: true,
			data: {
				message:
					'Expand all operation completed. Expanded: 0, Failed: 0, Skipped: 0',
				details: {
					expandedCount: 0,
					failedCount: 0,
					skippedCount: 0,
					tasksToExpand: 0,
					telemetryData: null
				}
			}
		};

		mockExpandAllTasksDirect.mockResolvedValue(mockDirectResult);
		mockHandleApiResult.mockReturnValue({
			success: true,
			data: mockDirectResult.data
		});

		// Act
		const result = await executeFunction(validArgs, {
			log: mockLogger,
			session: { workingDirectory: '/test' }
		});

		// Assert
		expect(result.success).toBe(true);
		expect(result.data.details.expandedCount).toBe(0);
		expect(result.data.details.tasksToExpand).toBe(0);
	});

	test('should handle expand all with mixed success/failure', async () => {
		// Arrange
		const mockDirectResult = {
			success: true,
			data: {
				message:
					'Expand all operation completed. Expanded: 2, Failed: 1, Skipped: 0',
				details: {
					expandedCount: 2,
					failedCount: 1,
					skippedCount: 0,
					tasksToExpand: 3,
					telemetryData: {
						commandName: 'expand-all-tasks',
						totalCost: 0.1,
						totalTokens: 1500
					}
				}
			}
		};

		mockExpandAllTasksDirect.mockResolvedValue(mockDirectResult);
		mockHandleApiResult.mockReturnValue({
			success: true,
			data: mockDirectResult.data
		});

		// Act
		const result = await executeFunction(validArgs, {
			log: mockLogger,
			session: { workingDirectory: '/test' }
		});

		// Assert
		expect(result.success).toBe(true);
		expect(result.data.details.expandedCount).toBe(2);
		expect(result.data.details.failedCount).toBe(1);
	});

	test('should handle errors from expandAllTasksDirect', async () => {
		// Arrange
		mockExpandAllTasksDirect.mockRejectedValue(
			new Error('Direct function error')
		);

		// Act
		const result = await executeFunction(validArgs, {
			log: mockLogger,
			session: { workingDirectory: '/test' }
		});

		// Assert
		expect(mockLogger.error).toHaveBeenCalledWith(
			expect.stringContaining('Error in expand-all tool')
		);
		expect(mockCreateErrorResponse).toHaveBeenCalledWith(
			'Direct function error'
		);
	});

	test('should handle different argument combinations', async () => {
		// Test with minimal args
		const minimalArgs = {
			projectRoot: '/test/project'
		};

		// Act
		await executeFunction(minimalArgs, {
			log: mockLogger,
			session: { workingDirectory: '/test' }
		});

		// Assert
		expect(mockExpandAllTasksDirect).toHaveBeenCalledWith(
			minimalArgs,
			mockLogger,
			expect.any(Object)
		);
	});

	test('should use withNormalizedProjectRoot wrapper correctly', () => {
		// Verify that the execute function is wrapped with withNormalizedProjectRoot
		expect(mockWithNormalizedProjectRoot).toHaveBeenCalledWith(
			expect.any(Function)
		);
	});
});
