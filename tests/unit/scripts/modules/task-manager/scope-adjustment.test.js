/**
 * Tests for scope-adjustment.js module
 */
import { vi } from 'vitest';

// Mock dependencies using unstable_mockModule for ES modules
vi.doMock(
	'../../../../../scripts/modules/utils.js',
	async (importOriginal) => ({
		// The real sum, so the usage line's totals are checked
		aggregateTelemetry: (await importOriginal()).aggregateTelemetry,
		log: vi.fn(),
		readJSON: vi.fn(),
		writeJSON: vi.fn(),
		getCurrentTag: vi.fn(() => 'master'),
		readComplexityReport: vi.fn(),
		findTaskInComplexityReport: vi.fn(),
		findProjectRoot: vi.fn()
	})
);

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn(),
	generateTextService: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/task-manager.js', () => ({
	findTaskById: vi.fn(),
	taskExists: vi.fn()
}));

vi.doMock(
	'../../../../../scripts/modules/task-manager/analyze-task-complexity.js',
	() => ({
		default: vi.fn()
	})
);

vi.doMock('../../../../../src/utils/path-utils.js', () => ({
	findComplexityReportPath: vi.fn()
}));

// Import modules after mocking
const {
	log,
	readJSON,
	writeJSON,
	readComplexityReport,
	findTaskInComplexityReport
} = await import('../../../../../scripts/modules/utils.js');
const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);
const { findTaskById, taskExists } = await import(
	'../../../../../scripts/modules/task-manager.js'
);
const { scopeUpTask, scopeDownTask, validateStrength } = await import(
	'../../../../../scripts/modules/task-manager/scope-adjustment.js'
);

describe('Scope Adjustment Commands', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('scopeUpTask', () => {
		it('should increase task complexity with regular strength', async () => {
			// Mock existing task data
			const mockTasksData = {
				tasks: [
					{
						id: 1,
						title: 'Simple Task',
						description: 'Basic description',
						details: 'Basic implementation details',
						status: 'pending'
					}
				]
			};

			const mockTask = {
				id: 1,
				title: 'Simple Task',
				description: 'Basic description',
				details: 'Basic implementation details',
				status: 'pending'
			};

			readJSON.mockReturnValue(mockTasksData);
			taskExists.mockReturnValue(true);
			findTaskById.mockReturnValue({ task: mockTask });
			generateObjectService.mockResolvedValue({
				mainResult: {
					title: 'Complex Task with Advanced Features',
					description: 'Enhanced description with more requirements',
					details:
						'Detailed implementation with error handling, validation, and advanced features',
					testStrategy:
						'Comprehensive testing including unit, integration, and edge cases'
				},
				telemetryData: { tokens: 100, cost: 0.01 }
			});

			const context = {
				projectRoot: '/test/project',
				tag: 'master',
				commandName: 'scope-up',
				outputType: 'cli'
			};

			const result = await scopeUpTask(
				'/test/tasks.json',
				[1],
				'regular',
				null, // no custom prompt
				context,
				'text'
			);

			expect(result).toBeDefined();
			expect(result.updatedTasks).toHaveLength(1);
			expect(result.telemetryData).toBeDefined();
			expect(writeJSON).toHaveBeenCalledWith(
				'/test/tasks.json',
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 1,
							title: 'Complex Task with Advanced Features'
						})
					])
				}),
				'/test/project',
				'master'
			);
		});

		it('should handle custom prompts for targeted scope adjustments', async () => {
			const mockTasksData = {
				tasks: [
					{
						id: 1,
						title: 'Simple Task',
						description: 'Basic description',
						details: 'Basic implementation details',
						status: 'pending'
					}
				]
			};

			const mockTask = {
				id: 1,
				title: 'Simple Task',
				description: 'Basic description',
				details: 'Basic implementation details',
				status: 'pending'
			};

			readJSON.mockReturnValue(mockTasksData);
			taskExists.mockReturnValue(true);
			findTaskById.mockReturnValue({ task: mockTask });
			generateObjectService.mockResolvedValue({
				mainResult: {
					title: 'Task with Enhanced Security',
					description: 'Description with security considerations',
					details: 'Implementation with security validation and encryption',
					testStrategy: 'Security-focused testing strategy'
				},
				telemetryData: { tokens: 120, cost: 0.012 }
			});

			const context = {
				projectRoot: '/test/project',
				tag: 'master',
				commandName: 'scope-up',
				outputType: 'cli'
			};

			const customPrompt = 'Focus on adding security features and validation';

			const result = await scopeUpTask(
				'/test/tasks.json',
				[1],
				'heavy',
				customPrompt,
				context,
				'text'
			);

			expect(result).toBeDefined();
			expect(generateObjectService).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining(
						'Focus on adding security features and validation'
					)
				})
			);
		});
	});

	describe('dependency provenance of regenerated subtasks', () => {
		it('records sibling dependencies the AI chose as inferred, keyed dotted under the task', async () => {
			const task = {
				id: 1,
				title: 'Task',
				description: 'Description',
				details: 'Details',
				status: 'pending',
				subtasks: [
					{ id: 1, title: 'Old A', status: 'pending', dependencies: [] },
					{ id: 2, title: 'Old B', status: 'pending', dependencies: [] }
				]
			};
			readJSON.mockReturnValue({ tasks: [structuredClone(task)] });
			taskExists.mockReturnValue(true);
			findTaskById.mockReturnValue({ task: structuredClone(task) });
			generateObjectService
				.mockResolvedValueOnce({
					mainResult: {
						title: 'Bigger task',
						description: 'Description',
						details: 'Details',
						testStrategy: 'Tests'
					},
					telemetryData: {}
				})
				.mockResolvedValueOnce({
					mainResult: {
						subtasks: [
							{
								id: 1,
								title: 'New A',
								description: 'a',
								dependencies: [],
								details: 'a'
							},
							{
								id: 2,
								title: 'New B',
								description: 'b',
								dependencies: ['1.1'],
								details: 'b'
							}
						]
					},
					telemetryData: {}
				});

			await scopeUpTask(
				'/test/tasks.json',
				[1],
				'regular',
				null,
				{ projectRoot: '/test/project', tag: 'master', outputType: 'cli' },
				'json'
			);

			const written = writeJSON.mock.calls[0][1].tasks[0];
			expect(written.subtasks.map((st) => st.title)).toEqual([
				'New A',
				'New B'
			]);
			expect(written.subtasks[0].metadata).toBeUndefined();
			expect(written.subtasks[1].metadata.dependencySources).toEqual({
				1.1: 'inferred'
			});
		});
	});

	describe('scopeDownTask', () => {
		it('should decrease task complexity with regular strength', async () => {
			const mockTasksData = {
				tasks: [
					{
						id: 1,
						title: 'Complex Task with Many Features',
						description: 'Comprehensive description with multiple requirements',
						details:
							'Detailed implementation with advanced features, error handling, validation',
						status: 'pending'
					}
				]
			};

			const mockTask = {
				id: 1,
				title: 'Complex Task with Many Features',
				description: 'Comprehensive description with multiple requirements',
				details:
					'Detailed implementation with advanced features, error handling, validation',
				status: 'pending'
			};

			readJSON.mockReturnValue(mockTasksData);
			taskExists.mockReturnValue(true);
			findTaskById.mockReturnValue({ task: mockTask });
			generateObjectService.mockResolvedValue({
				mainResult: {
					title: 'Simple Task',
					description: 'Basic description',
					details: 'Basic implementation focusing on core functionality',
					testStrategy: 'Simple unit tests for core functionality'
				},
				telemetryData: { tokens: 80, cost: 0.008 }
			});

			const context = {
				projectRoot: '/test/project',
				tag: 'master',
				commandName: 'scope-down',
				outputType: 'cli'
			};

			const result = await scopeDownTask(
				'/test/tasks.json',
				[1],
				'regular',
				null,
				context,
				'text'
			);

			expect(result).toBeDefined();
			expect(result.updatedTasks).toHaveLength(1);
			expect(writeJSON).toHaveBeenCalled();
		});
	});

	describe('strength level validation', () => {
		it('should validate strength parameter correctly', () => {
			expect(validateStrength('light')).toBe(true);
			expect(validateStrength('regular')).toBe(true);
			expect(validateStrength('heavy')).toBe(true);
			expect(validateStrength('invalid')).toBe(false);
			expect(validateStrength('')).toBe(false);
			expect(validateStrength(null)).toBe(false);
		});
	});

	describe('multiple task IDs handling', () => {
		it('should handle comma-separated task IDs', async () => {
			const mockTasksData = {
				tasks: [
					{
						id: 1,
						title: 'Task 1',
						description: 'Desc 1',
						details: 'Details 1',
						status: 'pending'
					},
					{
						id: 2,
						title: 'Task 2',
						description: 'Desc 2',
						details: 'Details 2',
						status: 'pending'
					}
				]
			};

			readJSON.mockReturnValue(mockTasksData);
			taskExists.mockReturnValue(true);
			findTaskById
				.mockReturnValueOnce({
					task: {
						id: 1,
						title: 'Task 1',
						description: 'Desc 1',
						details: 'Details 1',
						status: 'pending'
					}
				})
				.mockReturnValueOnce({
					task: {
						id: 2,
						title: 'Task 2',
						description: 'Desc 2',
						details: 'Details 2',
						status: 'pending'
					}
				});

			generateObjectService.mockResolvedValue({
				mainResult: {
					title: 'Enhanced Task',
					description: 'Enhanced description',
					details: 'Enhanced details',
					testStrategy: 'Enhanced testing'
				},
				telemetryData: {
					modelUsed: 'sonnet',
					inputTokens: 100,
					outputTokens: 20,
					cachedInputTokens: 50,
					totalTokens: 120
				}
			});

			const context = {
				projectRoot: '/test/project',
				tag: 'master',
				commandName: 'scope-up',
				outputType: 'cli'
			};

			const result = await scopeUpTask(
				'/test/tasks.json',
				[1, 2],
				'regular',
				null,
				context,
				'text'
			);

			expect(result.updatedTasks).toHaveLength(2);
			expect(generateObjectService).toHaveBeenCalledTimes(2);
			// One total for the usage line, cached tokens included
			expect(result.telemetryData).toMatchObject({
				commandName: 'scope-up',
				modelUsed: 'sonnet',
				inputTokens: 200,
				outputTokens: 40,
				cachedInputTokens: 100,
				totalTokens: 240
			});
		});
	});
});
