/**
 * Tests for the analyze-task-complexity.js module
 */
import { vi } from 'vitest';
import {
	createGetTagAwareFilePathMock,
	createSlugifyTagForFilePathMock
} from './setup.js';

// Mock the dependencies before importing the module under test
vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	CONFIG: {
		model: 'mock-claude-model',
		maxTokens: 4000,
		temperature: 0.7,
		debug: false,
		defaultSubtasks: 3
	},
	findTaskById: vi.fn(),
	readComplexityReport: vi.fn(),
	findTaskInComplexityReport: vi.fn(),
	findProjectRoot: vi.fn(() => '/mock/project/root'),
	resolveEnvVariable: vi.fn((varName) => `mock_${varName}`),
	isSilentMode: vi.fn(() => false),
	findCycles: vi.fn(() => []),
	formatTaskId: vi.fn((id) => `Task ${id}`),
	taskExists: vi.fn((tasks, id) => tasks.some((t) => t.id === id)),
	enableSilentMode: vi.fn(),
	disableSilentMode: vi.fn(),
	truncate: vi.fn((text) => text),
	addComplexityToTask: vi.fn((task, complexity) => ({ ...task, complexity })),
	aggregateTelemetry: vi.fn((telemetryArray) => telemetryArray[0] || {}),
	ensureTagMetadata: vi.fn((tagObj) => tagObj),
	getCurrentTag: vi.fn(() => 'master'),
	resolveTag: vi.fn(() => 'master'),
	flattenTasksWithSubtasks: vi.fn((tasks) => tasks),
	getTagAwareFilePath: createGetTagAwareFilePathMock(),
	slugifyTagForFilePath: createSlugifyTagForFilePathMock(),
	markMigrationForNotice: vi.fn(),
	performCompleteTagMigration: vi.fn(),
	setTasksForTag: vi.fn(),
	getTasksForTag: vi.fn((data, tag) => data[tag]?.tasks || []),
	traverseDependencies: vi.fn((tasks, taskId, visited) => [])
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			complexityAnalysis: []
		},
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'analyze-complexity',
			modelUsed: 'claude-3-5-sonnet',
			providerName: 'anthropic',
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
			totalCost: 0.012414,
			currency: 'USD'
		}
	}),
	generateTextService: vi.fn().mockResolvedValue({
		mainResult: '[]',
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'analyze-complexity',
			modelUsed: 'claude-3-5-sonnet',
			providerName: 'anthropic',
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
			totalCost: 0.012414,
			currency: 'USD'
		}
	}),
	streamTextService: vi.fn().mockResolvedValue({
		mainResult: async function* () {
			yield '{"tasks":[';
			yield '{"id":1,"title":"Test Task","priority":"high"}';
			yield ']}';
		},
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'analyze-complexity',
			modelUsed: 'claude-3-5-sonnet',
			providerName: 'anthropic',
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
			totalCost: 0.012414,
			currency: 'USD'
		}
	}),
	streamObjectService: vi.fn().mockImplementation(async () => {
		return {
			get partialObjectStream() {
				return (async function* () {
					yield { tasks: [] };
					yield { tasks: [{ id: 1, title: 'Test Task', priority: 'high' }] };
				})();
			},
			object: Promise.resolve({
				tasks: [{ id: 1, title: 'Test Task', priority: 'high' }]
			})
		};
	})
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	// Core config access
	getConfig: vi.fn(() => ({
		models: { main: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' } },
		global: { projectName: 'Test Project' }
	})),
	writeConfig: vi.fn(() => true),
	ConfigurationError: class extends Error {},
	isConfigFilePresent: vi.fn(() => true),

	// Validation
	validateProvider: vi.fn(() => true),
	validateProviderModelCombination: vi.fn(() => true),
	VALID_PROVIDERS: ['anthropic', 'openai', 'perplexity'],
	MODEL_MAP: {
		anthropic: [
			{
				id: 'claude-3-5-sonnet',
				cost_per_1m_tokens: { input: 3, output: 15 }
			}
		],
		openai: [{ id: 'gpt-4', cost_per_1m_tokens: { input: 30, output: 60 } }]
	},
	getAvailableModels: vi.fn(() => [
		{
			id: 'claude-3-5-sonnet',
			name: 'Claude 3.5 Sonnet',
			provider: 'anthropic'
		},
		{ id: 'gpt-4', name: 'GPT-4', provider: 'openai' }
	]),

	// Role-specific getters
	getMainProvider: vi.fn(() => 'anthropic'),
	getMainModelId: vi.fn(() => 'claude-3-5-sonnet'),
	getMainMaxTokens: vi.fn(() => 4000),
	getMainTemperature: vi.fn(() => 0.7),
	getResearchProvider: vi.fn(() => 'perplexity'),
	getResearchModelId: vi.fn(() => 'sonar-pro'),
	getResearchMaxTokens: vi.fn(() => 8700),
	getResearchTemperature: vi.fn(() => 0.1),
	getFallbackProvider: vi.fn(() => 'anthropic'),
	getFallbackModelId: vi.fn(() => 'claude-3-5-sonnet'),
	getFallbackMaxTokens: vi.fn(() => 4000),
	getFallbackTemperature: vi.fn(() => 0.7),
	getBaseUrlForRole: vi.fn(() => undefined),

	// Global setting getters
	getLogLevel: vi.fn(() => 'info'),
	getDebugFlag: vi.fn(() => false),
	getDefaultNumTasks: vi.fn(() => 10),
	getDefaultSubtasks: vi.fn(() => 5),
	getDefaultPriority: vi.fn(() => 'medium'),
	getProjectName: vi.fn(() => 'Test Project'),
	getOllamaBaseURL: vi.fn(() => 'http://localhost:11434/api'),
	getAzureBaseURL: vi.fn(() => undefined),
	getBedrockBaseURL: vi.fn(() => undefined),
	getParametersForRole: vi.fn(() => ({
		maxTokens: 4000,
		temperature: 0.7
	})),
	getUserId: vi.fn(() => '1234567890'),

	// API Key Checkers
	isApiKeySet: vi.fn(() => true),
	getMcpApiKeyStatus: vi.fn(() => true),

	// Additional functions
	getAllProviders: vi.fn(() => ['anthropic', 'openai', 'perplexity']),
	getVertexProjectId: vi.fn(() => undefined),
	getVertexLocation: vi.fn(() => undefined),
	hasCodebaseAnalysis: vi.fn(() => false),
	setSuppressConfigWarnings: vi.fn(),
	isConfigWarningSuppressed: vi.fn(() => false)
}));

// Mock fs module
const mockWriteFileSync = vi.fn();
vi.doMock('fs', async () => {
	// Keep the real exports (e.g. constants) so Jest 30's node:fs resolution works
	const actualFs = await vi.importActual('fs');
	const mocked = {
		existsSync: vi.fn(() => false),
		readFileSync: vi.fn(),
		writeFileSync: mockWriteFileSync,
		unlinkSync: vi.fn()
	};
	return { ...actualFs, ...mocked, default: { ...actualFs, ...mocked } };
});

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockResolvedValue({
			systemPrompt: 'Mocked system prompt',
			userPrompt: 'Mocked user prompt'
		})
	})
}));

// Import the mocked modules
const { readJSON, writeJSON, log, CONFIG, findTaskById } = await import(
	'../../../../../scripts/modules/utils.js'
);

const { generateObjectService, generateTextService, streamTextService } =
	await import('../../../../../scripts/modules/ai-services-unified.js');

const fs = await import('fs');

// Import the module under test
const { default: analyzeTaskComplexity } = await import(
	'../../../../../scripts/modules/task-manager/analyze-task-complexity.js'
);

describe('analyzeTaskComplexity', () => {
	// Sample response structure (simplified for these tests)
	const sampleApiResponse = {
		mainResult: JSON.stringify({
			tasks: [
				{ id: 1, complexity: 3, subtaskCount: 2 },
				{ id: 2, complexity: 7, subtaskCount: 5 },
				{ id: 3, complexity: 9, subtaskCount: 8 }
			]
		}),
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'analyze-complexity',
			modelUsed: 'claude-3-5-sonnet',
			providerName: 'anthropic',
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
			totalCost: 0.012414,
			currency: 'USD'
		}
	};

	const sampleTasks = {
		master: {
			tasks: [
				{
					id: 1,
					title: 'Task 1',
					description: 'First task description',
					status: 'pending',
					dependencies: [],
					priority: 'high'
				},
				{
					id: 2,
					title: 'Task 2',
					description: 'Second task description',
					status: 'pending',
					dependencies: [1],
					priority: 'medium'
				},
				{
					id: 3,
					title: 'Task 3',
					description: 'Third task description',
					status: 'done',
					dependencies: [1, 2],
					priority: 'high'
				}
			]
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Default mock implementations - readJSON should return the resolved view with tasks at top level
		readJSON.mockImplementation((tasksPath, projectRoot, tag) => {
			return {
				...sampleTasks.master,
				tag: tag || 'master',
				_rawTaggedData: sampleTasks
			};
		});

		// Mock findTaskById to return the expected structure
		findTaskById.mockImplementation((tasks, taskId) => {
			const task = tasks?.find((t) => t.id === parseInt(taskId));
			return { task: task || null, originalSubtaskCount: null };
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				complexityAnalysis: JSON.parse(sampleApiResponse.mainResult).tasks
			},
			telemetryData: sampleApiResponse.telemetryData
		});
	});

	test('should call generateObjectService with the correct parameters', async () => {
		// Arrange
		const options = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: '5',
			research: false,
			projectRoot: '/mock/project/root'
		};

		// Act
		await analyzeTaskComplexity(options, {
			projectRoot: '/mock/project/root',
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			}
		});

		// Assert
		expect(readJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			'/mock/project/root',
			undefined
		);
		expect(generateObjectService).toHaveBeenCalledWith(expect.any(Object));
		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('task-complexity-report.json'),
			expect.stringContaining('"thresholdScore": 5'),
			'utf8'
		);
	});

	test('should use research flag to determine which AI service to use', async () => {
		// Arrange
		const researchOptions = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: '5',
			research: true,
			projectRoot: '/mock/project/root'
		};

		// Act
		await analyzeTaskComplexity(researchOptions, {
			projectRoot: '/mock/project/root',
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			}
		});

		// Assert
		expect(generateObjectService).toHaveBeenCalledWith(
			expect.objectContaining({
				role: 'research' // This should be present when research is true
			})
		);
	});

	test('should handle different threshold parameter types correctly', async () => {
		// Test with string threshold
		let options = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: '7',
			projectRoot: '/mock/project/root'
		};

		await analyzeTaskComplexity(options, {
			projectRoot: '/mock/project/root',
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			}
		});

		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('task-complexity-report.json'),
			expect.stringContaining('"thresholdScore": 7'),
			'utf8'
		);

		// Reset mocks
		vi.clearAllMocks();

		// Test with number threshold
		options = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: 8,
			projectRoot: '/mock/project/root'
		};

		await analyzeTaskComplexity(options, {
			projectRoot: '/mock/project/root',
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			}
		});

		expect(mockWriteFileSync).toHaveBeenCalledWith(
			expect.stringContaining('task-complexity-report.json'),
			expect.stringContaining('"thresholdScore": 8'),
			'utf8'
		);
	});

	test('should filter out completed tasks from analysis', async () => {
		// Arrange
		const options = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: '5',
			projectRoot: '/mock/project/root'
		};

		// Act
		await analyzeTaskComplexity(options, {
			projectRoot: '/mock/project/root',
			mcpLog: {
				info: vi.fn(),
				warn: vi.fn(),
				error: vi.fn(),
				debug: vi.fn(),
				success: vi.fn()
			}
		});

		// Assert
		// Check if the prompt sent to AI doesn't include the completed task (id: 3)
		expect(generateObjectService).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: expect.not.stringContaining('"id": 3')
			})
		);
	});

	describe('skipped count', () => {
		const run = async (id) => {
			generateObjectService.mockResolvedValue({
				mainResult: {
					complexityAnalysis: id.split(',').map((taskId) => ({
						taskId: Number(taskId),
						taskTitle: `Task ${taskId}`,
						complexityScore: 5,
						recommendedSubtasks: 3,
						expansionPrompt: '',
						reasoning: ''
					}))
				},
				telemetryData: sampleApiResponse.telemetryData
			});
			const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
			await analyzeTaskComplexity(
				{
					file: 'tasks/tasks.json',
					output: 'scripts/task-complexity-report.json',
					projectRoot: '/mock/project/root',
					id
				},
				{ projectRoot: '/mock/project/root' }
			);
			const printed = logSpy.mock.calls.map((call) => String(call[0]));
			logSpy.mockRestore();
			return printed.join('\n');
		};

		test('does not count tasks left out by --id as done', async () => {
			const output = await run('1');

			expect(output).toContain('Analyzed');
			expect(output).not.toContain('skipped');
		});

		test('counts done tasks among the IDs you asked for', async () => {
			const output = await run('1,3');

			expect(output).toContain('skipped 1 done');
		});
	});

	test('should handle API errors gracefully', async () => {
		// Arrange
		const options = {
			file: 'tasks/tasks.json',
			output: 'scripts/task-complexity-report.json',
			threshold: '5',
			projectRoot: '/mock/project/root'
		};

		// Force API error
		generateObjectService.mockRejectedValueOnce(new Error('API Error'));

		const mockMcpLog = {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			success: vi.fn()
		};

		// Act & Assert
		await expect(
			analyzeTaskComplexity(options, {
				projectRoot: '/mock/project/root',
				mcpLog: mockMcpLog
			})
		).rejects.toThrow('API Error');

		// Check that the error was logged via mcpLog
		expect(mockMcpLog.error).toHaveBeenCalledWith(
			expect.stringContaining('API Error')
		);
	});
});
