/**
 * Tests for complexity report tag isolation functionality
 * Verifies that different tags maintain separate complexity reports
 */

import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';

// Mock fs module - consolidated single registration
const mockExistsSync = vi.fn();
const mockReadFileSync = vi.fn();
const mockWriteFileSync = vi.fn();
const mockUnlinkSync = vi.fn();
const mockMkdirSync = vi.fn();
const mockReaddirSync = vi.fn(() => []);
const mockStatSync = vi.fn(() => ({ isDirectory: () => false }));

vi.doMock('fs', () => ({
	default: {
		existsSync: mockExistsSync,
		readFileSync: mockReadFileSync,
		writeFileSync: mockWriteFileSync,
		unlinkSync: mockUnlinkSync,
		mkdirSync: mockMkdirSync,
		readdirSync: mockReaddirSync,
		statSync: mockStatSync
	},
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
	writeFileSync: mockWriteFileSync,
	unlinkSync: mockUnlinkSync,
	mkdirSync: mockMkdirSync,
	readdirSync: mockReaddirSync,
	statSync: mockStatSync
}));

// Mock the dependencies
vi.doMock('../../../../../src/utils/path-utils.js', () => ({
	resolveComplexityReportOutputPath: vi.fn(),
	findComplexityReportPath: vi.fn(),
	findConfigPath: vi.fn(),
	findPRDPath: vi.fn(() => '/mock/project/root/.taskgraph/docs/PRD.md'),
	findTasksPath: vi.fn(() => '/mock/project/root/.taskgraph/tasks/tasks.json'),
	normalizeProjectRoot: vi.fn((root) => root)
}));

// The real helper edits the file under a lock; here it edits what the mocked
// readJSON returns
vi.doMock(
	'../../../../../scripts/modules/utils/update-tag-tasks.js',
	async () => {
		const { readJSON } = await import(
			'../../../../../scripts/modules/utils.js'
		);
		return {
			updateTagTasks: vi.fn(async (filepath, tag, mutate) => {
				const view = readJSON(filepath);
				return mutate((view._rawTaggedData ?? { [tag]: view })[tag]);
			})
		};
	}
);

vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	isSilentMode: vi.fn(() => false),
	enableSilentMode: vi.fn(),
	disableSilentMode: vi.fn(),
	flattenTasksWithSubtasks: vi.fn((tasks) => tasks),
	getTagAwareFilePath: vi.fn((basePath, tag, projectRoot) => {
		if (tag && tag !== 'master') {
			const dir = path.dirname(basePath);
			const ext = path.extname(basePath);
			const name = path.basename(basePath, ext);
			return path.join(projectRoot || '.', dir, `${name}_${tag}${ext}`);
		}
		return path.join(projectRoot || '.', basePath);
	}),
	findTaskById: vi.fn((tasks, taskId) => {
		if (!tasks || !Array.isArray(tasks)) {
			return { task: null, originalSubtaskCount: null, originalSubtasks: null };
		}
		const id = parseInt(taskId, 10);
		const task = tasks.find((t) => t.id === id);
		return task
			? { task, originalSubtaskCount: null, originalSubtasks: null }
			: { task: null, originalSubtaskCount: null, originalSubtasks: null };
	}),
	taskExists: vi.fn((tasks, taskId) => {
		if (!tasks || !Array.isArray(tasks)) return false;
		const id = parseInt(taskId, 10);
		return tasks.some((t) => t.id === id);
	}),
	formatTaskId: vi.fn((id) => `Task ${id}`),
	findCycles: vi.fn(() => []),
	truncate: vi.fn((text) => text),
	addComplexityToTask: vi.fn((task, complexity) => ({ ...task, complexity })),
	ensureTagMetadata: vi.fn((tagObj) => tagObj),
	getCurrentTag: vi.fn(() => 'master'),
	resolveTag: vi.fn(() => 'master'),
	markMigrationForNotice: vi.fn(),
	findProjectRoot: vi.fn(() => '/mock/project/root'),
	readComplexityReport: vi.fn(),
	findTaskInComplexityReport: vi.fn(),
	resolveEnvVariable: vi.fn((varName) => `mock_${varName}`),
	isEmpty: vi.fn(() => false),
	normalizeProjectRoot: vi.fn((root) => root),
	slugifyTagForFilePath: vi.fn((tagName) => {
		if (!tagName || typeof tagName !== 'string') {
			return 'unknown-tag';
		}
		return tagName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
	}),
	createTagAwareFilePath: vi.fn((basePath, tag, projectRoot) => {
		if (tag && tag !== 'master') {
			const dir = path.dirname(basePath);
			const ext = path.extname(basePath);
			const name = path.basename(basePath, ext);
			// Use the slugified tag
			const slugifiedTag = tag.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
			return path.join(
				projectRoot || '.',
				dir,
				`${name}_${slugifiedTag}${ext}`
			);
		}
		return path.join(projectRoot || '.', basePath);
	}),
	CONFIG: {
		defaultSubtasks: 3
	}
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: vi.fn().mockImplementation((params) => {
		const commandName = params?.commandName || 'default';

		if (commandName === 'analyze-complexity') {
			// Check if this is for a specific tag test by looking at the prompt
			const isFeatureTag =
				params?.prompt?.includes('feature') || params?.role === 'feature';
			const isMasterTag =
				params?.prompt?.includes('master') || params?.role === 'master';

			let taskTitle = 'Test Task';
			if (isFeatureTag) {
				taskTitle = 'Feature Task 1';
			} else if (isMasterTag) {
				taskTitle = 'Master Task 1';
			}

			return Promise.resolve({
				mainResult: JSON.stringify([
					{
						taskId: 1,
						taskTitle: taskTitle,
						complexityScore: 7,
						recommendedSubtasks: 4,
						expansionPrompt: 'Break down this task',
						reasoning: 'This task is moderately complex'
					},
					{
						taskId: 2,
						taskTitle: 'Task 2',
						complexityScore: 5,
						recommendedSubtasks: 3,
						expansionPrompt: 'Break down this task with a focus on task 2.',
						reasoning:
							'Automatically added due to missing analysis in AI response.'
					}
				]),
				telemetryData: {
					timestamp: new Date().toISOString(),
					commandName: 'analyze-complexity',
					modelUsed: 'claude-3-5-sonnet',
					providerName: 'anthropic',
					inputTokens: 1000,
					outputTokens: 500,
					totalTokens: 1500,
					totalCost: 0.012414,
					currency: 'USD'
				}
			});
		} else {
			// Default for expand-task and others
			return Promise.resolve({
				mainResult: JSON.stringify({
					subtasks: [
						{
							id: 1,
							title: 'Subtask 1',
							description: 'First subtask',
							dependencies: [],
							details: 'Implementation details',
							status: 'pending',
							testStrategy: 'Test strategy'
						}
					]
				}),
				telemetryData: {
					timestamp: new Date().toISOString(),
					commandName: commandName || 'expand-task',
					modelUsed: 'claude-3-5-sonnet',
					providerName: 'anthropic',
					inputTokens: 1000,
					outputTokens: 500,
					totalTokens: 1500,
					totalCost: 0.012414,
					currency: 'USD'
				}
			});
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
	generateObjectService: vi.fn().mockImplementation((params) => {
		const commandName = params?.commandName || 'default';

		if (commandName === 'analyze-complexity') {
			// Check if this is for a specific tag test by looking at the prompt
			const isFeatureTag =
				params?.prompt?.includes('feature') || params?.role === 'feature';
			const isMasterTag =
				params?.prompt?.includes('master') || params?.role === 'master';

			let taskTitle = 'Test Task';
			if (isFeatureTag) {
				taskTitle = 'Feature Task 1';
			} else if (isMasterTag) {
				taskTitle = 'Master Task 1';
			}

			return Promise.resolve({
				mainResult: {
					complexityAnalysis: [
						{
							taskId: 1,
							taskTitle: taskTitle,
							complexityScore: 7,
							recommendedSubtasks: 4,
							expansionPrompt: 'Break down this task',
							reasoning: 'This task is moderately complex'
						},
						{
							taskId: 2,
							taskTitle: 'Task 2',
							complexityScore: 5,
							recommendedSubtasks: 3,
							expansionPrompt: 'Break down this task with a focus on task 2.',
							reasoning:
								'Automatically added due to missing analysis in AI response.'
						}
					]
				},
				telemetryData: {
					timestamp: new Date().toISOString(),
					commandName: 'analyze-complexity',
					modelUsed: 'claude-3-5-sonnet',
					providerName: 'anthropic',
					inputTokens: 1000,
					outputTokens: 500,
					totalTokens: 1500,
					totalCost: 0.012414,
					currency: 'USD'
				}
			});
		}

		// Default response for expand-task and others
		return Promise.resolve({
			mainResult: {
				subtasks: [
					{
						id: 1,
						title: 'Subtask 1',
						description: 'First subtask',
						dependencies: [],
						details: 'Implementation details',
						status: 'pending',
						testStrategy: 'Test strategy'
					}
				]
			},
			telemetryData: {
				timestamp: new Date().toISOString(),
				commandName: 'expand-task',
				modelUsed: 'claude-3-5-sonnet',
				providerName: 'anthropic',
				inputTokens: 1000,
				outputTokens: 500,
				totalTokens: 1500,
				totalCost: 0.012414,
				currency: 'USD'
			}
		});
	})
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	// Core config access
	getConfig: vi.fn(() => ({
		models: { main: { provider: 'anthropic', modelId: 'claude-3-5-sonnet' } },
		global: { projectName: 'Test Project' }
	})),
	writeConfig: vi.fn(() => true),
	isConfigFilePresent: vi.fn(() => true),

	// Validation
	validateProvider: vi.fn(() => true),
	validateProviderModelCombination: vi.fn(() => true),
	CUSTOM_PROVIDERS: { OLLAMA: 'ollama', BEDROCK: 'bedrock' },
	ALL_PROVIDERS: ['anthropic', 'openai', 'perplexity', 'ollama', 'bedrock'],
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
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('@tm/core', async () => ({
	...(await vi.importActual('@tm/core')),
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockReturnValue({
			systemPrompt: 'Mocked system prompt',
			userPrompt: 'Mocked user prompt'
		})
	})
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => {
	class MockContextGatherer {
		constructor(projectRoot, tag) {
			this.projectRoot = projectRoot;
			this.tag = tag;
			this.allTasks = [];
		}

		async gather(options = {}) {
			return {
				context: 'Mock context gathered',
				analysisData: null,
				contextSections: 1,
				finalTaskIds: options.tasks || []
			};
		}
	}

	return {
		ContextGatherer: MockContextGatherer
	};
});

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	startLoadingIndicator: vi.fn(() => ({ stop: vi.fn() })),
	stopLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn(),
	displayBanner: vi.fn(),
	getStatusWithColor: vi.fn((status) => status),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayContextAnalysis: vi.fn(),
	createProgressBar: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		update: vi.fn()
	})),
	displayTable: vi.fn(),
	displayBox: vi.fn(),
	displaySuccess: vi.fn(),
	displayError: vi.fn(),
	displayWarning: vi.fn(),
	displayInfo: vi.fn(),
	displayTaskDetails: vi.fn(),
	displayTaskList: vi.fn(),
	displayComplexityReport: vi.fn(),
	displayDependencyStatus: vi.fn(),
	displayMigrationNotice: vi.fn(),
	formatDependenciesWithStatus: vi.fn((deps) => deps),
	formatTaskId: vi.fn((id) => `Task ${id}`),
	formatPriority: vi.fn((priority) => priority),
	formatDuration: vi.fn((duration) => duration),
	formatDate: vi.fn((date) => date),
	formatComplexityScore: vi.fn((score) => score),
	formatTelemetryData: vi.fn((data) => data),
	formatContextSummary: vi.fn((context) => context),
	formatTagName: vi.fn((tag) => tag),
	formatFilePath: vi.fn((path) => path),
	getComplexityWithColor: vi.fn((complexity) => complexity),
	getPriorityWithColor: vi.fn((priority) => priority),
	getTagWithColor: vi.fn((tag) => tag),
	getDependencyWithColor: vi.fn((dep) => dep),
	getTelemetryWithColor: vi.fn((data) => data),
	getContextWithColor: vi.fn((context) => context)
}));

// fs module already mocked at top of file with shared spy references

// Mock bridge-utils module
vi.doMock('../../../../../scripts/modules/bridge-utils.js', () => ({
	createBridgeLogger: vi.fn(() => ({
		logger: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			debug: vi.fn()
		},
		report: vi.fn(),
		isMCP: false
	}))
}));

// Import the mocked modules
const { resolveComplexityReportOutputPath, findComplexityReportPath } =
	await import('../../../../../src/utils/path-utils.js');

const { readJSON, writeJSON, getTagAwareFilePath } = await import(
	'../../../../../scripts/modules/utils.js'
);

const { generateTextService, generateObjectService, streamTextService } =
	await import('../../../../../scripts/modules/ai-services-unified.js');

// Import the modules under test
const { default: analyzeTaskComplexity } = await import(
	'../../../../../scripts/modules/task-manager/analyze-task-complexity.js'
);

describe('Complexity Report Tag Isolation', () => {
	const projectRoot = '/mock/project/root';
	const sampleTasks = {
		tasks: [
			{
				id: 1,
				title: 'Task 1',
				description: 'First task',
				status: 'pending'
			},
			{
				id: 2,
				title: 'Task 2',
				description: 'Second task',
				status: 'pending'
			}
		]
	};

	const sampleComplexityReport = {
		meta: {
			generatedAt: new Date().toISOString(),
			tasksAnalyzed: 2,
			totalTasks: 2,
			analysisCount: 2,
			thresholdScore: 5,
			projectName: 'Test Project',
			usedResearch: false
		},
		complexityAnalysis: [
			{
				taskId: 1,
				taskTitle: 'Task 1',
				complexityScore: 7,
				recommendedSubtasks: 4,
				expansionPrompt: 'Break down this task',
				reasoning: 'This task is moderately complex'
			},
			{
				taskId: 2,
				taskTitle: 'Task 2',
				complexityScore: 5,
				recommendedSubtasks: 3,
				expansionPrompt: 'Break down this task',
				reasoning: 'This task is moderately complex'
			}
		]
	};

	beforeEach(() => {
		vi.clearAllMocks();

		// Default mock implementations
		readJSON.mockReturnValue(sampleTasks);
		mockExistsSync.mockReturnValue(false);
		mockMkdirSync.mockImplementation(() => {});

		// Mock resolveComplexityReportOutputPath to return tag-aware paths
		resolveComplexityReportOutputPath.mockImplementation(
			(explicitPath, args) => {
				const tag = args?.tag;
				if (explicitPath) {
					return explicitPath;
				}

				let filename = 'task-complexity-report.json';
				if (tag && tag !== 'master') {
					// Use slugified tag for cross-platform compatibility
					const slugifiedTag = tag
						.replace(/[^a-zA-Z0-9_-]/g, '-')
						.toLowerCase();
					filename = `task-complexity-report_${slugifiedTag}.json`;
				}

				return path.join(projectRoot, '.taskgraph/reports', filename);
			}
		);

		// Mock findComplexityReportPath to return tag-aware paths
		findComplexityReportPath.mockImplementation((explicitPath, args) => {
			const tag = args?.tag;
			if (explicitPath) {
				return explicitPath;
			}

			let filename = 'task-complexity-report.json';
			if (tag && tag !== 'master') {
				filename = `task-complexity-report_${tag}.json`;
			}

			return path.join(projectRoot, '.taskgraph/reports', filename);
		});
	});

	describe('Path Resolution Tag Isolation', () => {
		test('should resolve master tag to default filename', () => {
			const result = resolveComplexityReportOutputPath(null, {
				tag: 'master',
				projectRoot
			});
			expect(result).toBe(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				)
			);
		});

		test('should resolve non-master tag to tag-specific filename', () => {
			const result = resolveComplexityReportOutputPath(null, {
				tag: 'feature-auth',
				projectRoot
			});
			expect(result).toBe(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				)
			);
		});

		test('should resolve undefined tag to default filename', () => {
			const result = resolveComplexityReportOutputPath(null, { projectRoot });
			expect(result).toBe(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				)
			);
		});

		test('should respect explicit path over tag-aware resolution', () => {
			const explicitPath = '/custom/path/report.json';
			const result = resolveComplexityReportOutputPath(explicitPath, {
				tag: 'feature-auth',
				projectRoot
			});
			expect(result).toBe(explicitPath);
		});
	});

	describe('Analysis Generation Tag Isolation', () => {
		test('should generate master tag report to default location', async () => {
			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'master'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(resolveComplexityReportOutputPath).toHaveBeenCalledWith(
				undefined,
				expect.objectContaining({
					tag: 'master',
					projectRoot
				}),
				expect.any(Function)
			);

			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				),
				expect.any(String),
				'utf8'
			);
		});

		test('should generate feature tag report to tag-specific location', async () => {
			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature-auth'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(resolveComplexityReportOutputPath).toHaveBeenCalledWith(
				undefined,
				expect.objectContaining({
					tag: 'feature-auth',
					projectRoot
				}),
				expect.any(Function)
			);

			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				),
				expect.any(String),
				'utf8'
			);
		});

		test('should not overwrite master report when analyzing feature tag', async () => {
			// First, analyze master tag
			const masterOptions = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'master'
			};

			await analyzeTaskComplexity(masterOptions, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			// Clear mocks to verify separate calls
			vi.clearAllMocks();
			readJSON.mockReturnValue(sampleTasks);

			// Then, analyze feature tag
			const featureOptions = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature-auth'
			};

			await analyzeTaskComplexity(featureOptions, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			// Verify that the feature tag analysis wrote to its own file
			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				),
				expect.any(String),
				'utf8'
			);

			// Verify that it did NOT write to the master file
			expect(mockWriteFileSync).not.toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				),
				expect.any(String),
				'utf8'
			);
		});
	});

	describe('Report Reading Tag Isolation', () => {
		test('should read master tag report from default location', async () => {
			// Mock existing master report
			mockExistsSync.mockImplementation((filepath) => {
				return filepath.endsWith('task-complexity-report.json');
			});
			mockReadFileSync.mockReturnValue(JSON.stringify(sampleComplexityReport));

			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'master'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(mockExistsSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				)
			);
		});

		test('should read feature tag report from tag-specific location', async () => {
			// Mock existing feature tag report
			mockExistsSync.mockImplementation((filepath) => {
				return filepath.endsWith('task-complexity-report_feature-auth.json');
			});
			mockReadFileSync.mockReturnValue(JSON.stringify(sampleComplexityReport));

			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature-auth'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(mockExistsSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				)
			);
		});

		test('should not read master report when working with feature tag', async () => {
			// Mock that feature tag report exists but master doesn't
			mockExistsSync.mockImplementation((filepath) => {
				return filepath.endsWith('task-complexity-report_feature-auth.json');
			});
			mockReadFileSync.mockReturnValue(JSON.stringify(sampleComplexityReport));

			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature-auth'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			// Should check for feature tag report
			expect(mockExistsSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				)
			);

			// Should NOT check for master report
			expect(mockExistsSync).not.toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				)
			);
		});
	});

	describe('Cross-Tag Contamination Prevention', () => {
		test('should maintain separate reports for different tags', async () => {
			// Create different complexity reports for different tags
			const masterReport = {
				...sampleComplexityReport,
				complexityAnalysis: [
					{
						taskId: 1,
						taskTitle: 'Master Task 1',
						complexityScore: 8,
						recommendedSubtasks: 5,
						expansionPrompt: 'Master expansion',
						reasoning: 'Master task reasoning'
					}
				]
			};

			const featureReport = {
				...sampleComplexityReport,
				complexityAnalysis: [
					{
						taskId: 1,
						taskTitle: 'Feature Task 1',
						complexityScore: 6,
						recommendedSubtasks: 3,
						expansionPrompt: 'Feature expansion',
						reasoning: 'Feature task reasoning'
					}
				]
			};

			// Mock file system to return different reports for different paths
			mockExistsSync.mockImplementation((filepath) => {
				return filepath.includes('task-complexity-report');
			});

			mockReadFileSync.mockImplementation((filepath) => {
				if (filepath.includes('task-complexity-report_feature-auth.json')) {
					return JSON.stringify(featureReport);
				} else if (filepath.includes('task-complexity-report.json')) {
					return JSON.stringify(masterReport);
				}
				return '{}';
			});

			// Analyze master tag
			const masterOptions = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'master'
			};

			await analyzeTaskComplexity(masterOptions, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			// Verify that master report was written to master location
			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report.json'
				),
				expect.stringContaining('"taskTitle": "Test Task"'),
				'utf8'
			);

			// Clear mocks
			vi.clearAllMocks();
			readJSON.mockReturnValue(sampleTasks);

			// Analyze feature tag
			const featureOptions = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature-auth'
			};

			await analyzeTaskComplexity(featureOptions, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			// Verify that feature report was written to feature location
			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-auth.json'
				),
				expect.stringContaining('"taskTitle": "Test Task"'),
				'utf8'
			);
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty tag gracefully', async () => {
			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: ''
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(resolveComplexityReportOutputPath).toHaveBeenCalledWith(
				undefined,
				expect.objectContaining({
					tag: '',
					projectRoot
				}),
				expect.any(Function)
			);
		});

		test('should handle null tag gracefully', async () => {
			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: null
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(resolveComplexityReportOutputPath).toHaveBeenCalledWith(
				undefined,
				expect.objectContaining({
					tag: null,
					projectRoot
				}),
				expect.any(Function)
			);
		});

		test('should handle special characters in tag names', async () => {
			const options = {
				file: 'tasks/tasks.json',
				threshold: '5',
				projectRoot,
				tag: 'feature/user-auth-v2'
			};

			await analyzeTaskComplexity(options, {
				projectRoot,
				mcpLog: {
					info: vi.fn(),
					warn: vi.fn(),
					error: vi.fn(),
					debug: vi.fn(),
					success: vi.fn()
				}
			});

			expect(resolveComplexityReportOutputPath).toHaveBeenCalledWith(
				undefined,
				expect.objectContaining({
					tag: 'feature/user-auth-v2',
					projectRoot
				}),
				expect.any(Function)
			);

			expect(mockWriteFileSync).toHaveBeenCalledWith(
				path.join(
					projectRoot,
					'.taskgraph/reports',
					'task-complexity-report_feature-user-auth-v2.json'
				),
				expect.any(String),
				'utf8'
			);
		});
	});
});
