import fs from 'fs';
/**
 * Tests for the expand-task.js module
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
		debug: false
	},
	sanitizePrompt: vi.fn((prompt) => prompt),
	truncate: vi.fn((text) => text),
	isSilentMode: vi.fn(() => false),
	findTaskById: vi.fn(),
	findProjectRoot: vi.fn((tasksPath) => '/mock/project/root'),
	getCurrentTag: vi.fn(() => 'master'),
	resolveTag: vi.fn(() => 'master'),
	addComplexityToTask: vi.fn((task, complexity) => ({ ...task, complexity })),
	ensureTagMetadata: vi.fn((tagObj) => tagObj),
	flattenTasksWithSubtasks: vi.fn((tasks) => {
		const allTasks = [];
		const queue = [...(tasks || [])];
		while (queue.length > 0) {
			const task = queue.shift();
			allTasks.push(task);
			if (task.subtasks) {
				for (const subtask of task.subtasks) {
					queue.push({ ...subtask, id: `${task.id}.${subtask.id}` });
				}
			}
		}
		return allTasks;
	}),
	getTagAwareFilePath: createGetTagAwareFilePathMock(),
	slugifyTagForFilePath: createSlugifyTagForFilePathMock(),
	readComplexityReport: vi.fn(),
	markMigrationForNotice: vi.fn(),
	performCompleteTagMigration: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	displayBanner: vi.fn(),
	getStatusWithColor: vi.fn((status) => status),
	startLoadingIndicator: vi.fn(),
	stopLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayAddedSubtasks: vi.fn(),
	displayAiUsageSummary: vi.fn(),
	displayContextAnalysis: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			subtasks: [
				{
					id: 1,
					title: 'Set up project structure',
					description:
						'Create the basic project directory structure and configuration files',
					dependencies: [],
					details:
						'Initialize package.json, create src/ and test/ directories, set up linting configuration',
					status: 'pending',
					testStrategy: 'Verify all expected files and directories are created'
				},
				{
					id: 2,
					title: 'Implement core functionality',
					description: 'Develop the main application logic and core features',
					dependencies: [1],
					details:
						'Create main classes, implement business logic, set up data models',
					status: 'pending',
					testStrategy: 'Unit tests for all core functions and classes'
				},
				{
					id: 3,
					title: 'Add user interface',
					description: 'Create the user interface components and layouts',
					dependencies: [2],
					details:
						'Design UI components, implement responsive layouts, add user interactions',
					status: 'pending',
					testStrategy: 'UI tests and visual regression testing'
				}
			]
		},
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'expand-task',
			modelUsed: 'claude-3-5-sonnet',
			providerName: 'anthropic',
			inputTokens: 1000,
			outputTokens: 500,
			totalTokens: 1500,
			totalCost: 0.012414,
			currency: 'USD'
		}
	})
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDefaultSubtasks: vi.fn(() => 3),
	getDebugFlag: vi.fn(() => false),
	getDefaultNumTasks: vi.fn(() => 10),
	getMainProvider: vi.fn(() => 'openai'),
	getResearchProvider: vi.fn(() => 'perplexity'),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockResolvedValue({
				context: 'Mock project context from files'
			})
		};
	})
}));

vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(function () {
		return {
			findRelevantTasks: vi.fn().mockReturnValue([]),
			getTaskIds: vi.fn().mockReturnValue([])
		};
	})
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

// Mock external UI libraries
vi.doMock('chalk', () => ({
	default: {
		white: { bold: vi.fn((text) => text) },
		cyan: Object.assign(
			vi.fn((text) => text),
			{
				bold: vi.fn((text) => text)
			}
		),
		green: vi.fn((text) => text),
		yellow: vi.fn((text) => text),
		red: vi.fn((text) => text),
		blue: vi.fn((text) => text),
		magenta: vi.fn((text) => text),
		gray: vi.fn((text) => text),
		bold: vi.fn((text) => text),
		dim: vi.fn((text) => text)
	}
}));

vi.doMock('cli-table3', () => ({
	default: vi.fn().mockImplementation(function () {
		return {
			push: vi.fn(),
			toString: vi.fn(() => 'mocked table')
		};
	})
}));

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

// The real helper edits the file under a lock. Here it edits the mocked file
// contents and hands the result to writeJSON so tests can look at it.
vi.doMock(
	'../../../../../scripts/modules/utils/update-tag-tasks.js',
	async () => {
		const { readJSON, writeJSON } = await import(
			'../../../../../scripts/modules/utils.js'
		);
		return {
			updateTagTasks: vi.fn(async (filepath, tag, mutate) => {
				const view = readJSON(filepath);
				const raw = view._rawTaggedData ?? { [tag]: view };
				const result = mutate(raw[tag]);
				writeJSON(filepath, raw);
				return result;
			})
		};
	}
);

// Mock process.exit to prevent Jest worker crashes
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`process.exit called with "${code}"`);
});

// Import the mocked modules
const {
	readJSON,
	writeJSON,
	log,
	findTaskById,
	ensureTagMetadata,
	readComplexityReport,
	findProjectRoot
} = await import('../../../../../scripts/modules/utils.js');

const { updateTagTasks } = await import(
	'../../../../../scripts/modules/utils/update-tag-tasks.js'
);

const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);

const { getDefaultSubtasks } = await import(
	'../../../../../scripts/modules/config-manager.js'
);

// Import the module under test
const { default: expandTask } = await import(
	'../../../../../scripts/modules/task-manager/expand-task.js'
);

describe('expandTask', () => {
	const sampleTasks = {
		master: {
			tasks: [
				{
					id: 1,
					title: 'Task 1',
					description: 'First task',
					status: 'done',
					dependencies: [],
					details: 'Already completed task',
					subtasks: []
				},
				{
					id: 2,
					title: 'Task 2',
					description: 'Second task',
					status: 'pending',
					dependencies: [],
					details: 'Task ready for expansion',
					subtasks: []
				},
				{
					id: 3,
					title: 'Complex Task',
					description: 'A complex task that needs breakdown',
					status: 'pending',
					dependencies: [1],
					details: 'This task involves multiple steps',
					subtasks: []
				},
				{
					id: 4,
					title: 'Task with existing subtasks',
					description: 'Task that already has subtasks',
					status: 'pending',
					dependencies: [],
					details: 'Has existing subtasks',
					subtasks: [
						{
							id: 1,
							title: 'Existing subtask',
							description: 'Already exists',
							status: 'pending',
							dependencies: []
						}
					]
				}
			]
		},
		'feature-branch': {
			tasks: [
				{
					id: 1,
					title: 'Feature Task 1',
					description: 'Task in feature branch',
					status: 'pending',
					dependencies: [],
					details: 'Feature-specific task',
					subtasks: []
				}
			]
		}
	};

	// Create a helper function for consistent mcpLog mock
	const createMcpLogMock = () => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
		success: vi.fn()
	});

	beforeEach(() => {
		vi.clearAllMocks();
		mockExit.mockClear();

		// Default readJSON implementation - returns tagged structure
		readJSON.mockImplementation((tasksPath, projectRoot, tag) => {
			const sampleTasksCopy = JSON.parse(JSON.stringify(sampleTasks));
			const selectedTag = tag || 'master';
			return {
				...sampleTasksCopy[selectedTag],
				tag: selectedTag,
				_rawTaggedData: sampleTasksCopy
			};
		});

		// Default findTaskById implementation
		findTaskById.mockImplementation((tasks, taskId) => {
			const id = parseInt(taskId, 10);
			return tasks.find((t) => t.id === id);
		});

		// Default complexity report (no report available)
		readComplexityReport.mockReturnValue(null);

		// Mock findProjectRoot to return consistent path for complexity report
		findProjectRoot.mockReturnValue('/mock/project/root');

		writeJSON.mockResolvedValue();
		log.mockImplementation(() => {});

		// Mock console.log to avoid output during tests
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		console.log.mockRestore();
	});

	describe('Basic Functionality', () => {
		test('should expand a task with AI-generated subtasks', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const numSubtasks = 3;
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			const result = await expandTask(
				tasksPath,
				taskId,
				numSubtasks,
				false,
				'',
				context,
				false
			);

			// Assert
			expect(readJSON).toHaveBeenCalledWith(
				tasksPath,
				'/mock/project/root',
				undefined
			);
			expect(generateObjectService).toHaveBeenCalledWith(expect.any(Object));
			expect(updateTagTasks).toHaveBeenCalledWith(
				tasksPath,
				'master',
				expect.any(Function)
			);
			expect(writeJSON.mock.calls[0][1].master).toEqual(
				expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 2,
							subtasks: expect.arrayContaining([
								expect.objectContaining({
									id: 1,
									title: 'Set up project structure',
									status: 'pending'
								}),
								expect.objectContaining({
									id: 2,
									title: 'Implement core functionality',
									status: 'pending'
								}),
								expect.objectContaining({
									id: 3,
									title: 'Add user interface',
									status: 'pending'
								})
							])
						})
					])
				})
			);
			expect(result).toEqual(
				expect.objectContaining({
					task: expect.objectContaining({
						id: 2,
						subtasks: expect.arrayContaining([
							expect.objectContaining({
								id: 1,
								title: 'Set up project structure',
								status: 'pending'
							}),
							expect.objectContaining({
								id: 2,
								title: 'Implement core functionality',
								status: 'pending'
							}),
							expect.objectContaining({
								id: 3,
								title: 'Add user interface',
								status: 'pending'
							})
						])
					}),
					telemetryData: expect.any(Object)
				})
			);
		});

		test('should record AI-chosen subtask dependencies as inferred', async () => {
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			const result = await expandTask(
				'tasks/tasks.json',
				'2',
				3,
				false,
				'',
				context,
				false
			);

			const [first, second, third] = result.task.subtasks;
			expect(first.metadata).toBeUndefined();
			// sibling marks are keyed dotted under the parent task (2)
			expect(second.metadata.dependencySources).toEqual({ 2.1: 'inferred' });
			expect(third.metadata.dependencySources).toEqual({ 2.2: 'inferred' });
		});

		test('orders subtasks before saving so none waits on a later one (#515)', async () => {
			generateObjectService.mockResolvedValueOnce({
				mainResult: {
					subtasks: [
						{
							id: 1,
							title: 'Wire the UI',
							dependencies: [2],
							status: 'pending'
						},
						{
							id: 2,
							title: 'Build the API',
							dependencies: ['3'],
							status: 'pending'
						}
					]
				},
				telemetryData: {}
			});

			const result = await expandTask(
				'tasks/tasks.json',
				'2',
				2,
				false,
				'',
				{ mcpLog: createMcpLogMock(), projectRoot: '/mock/project/root' },
				false
			);

			const [first, second] = result.task.subtasks;
			// Task 2 doesn't depend on task 3, so 2.1 can't either
			expect([first.id, first.title, first.dependencies]).toEqual([
				1,
				'Build the API',
				[]
			]);
			expect([second.id, second.title, second.dependencies]).toEqual([
				2,
				'Wire the UI',
				[1]
			]);
			expect(second.metadata.dependencySources).toEqual({ 2.1: 'inferred' });
		});

		test("keeps the task's related and discovered-from links", async () => {
			const links = { 1: 'discovered-from', 3: 'related' };
			readJSON.mockImplementation((tasksPath, projectRoot, tag) => {
				const data = JSON.parse(JSON.stringify(sampleTasks));
				data.master.tasks[1].metadata = { taskLinks: links };
				return {
					...data[tag || 'master'],
					tag: 'master',
					_rawTaggedData: data
				};
			});

			const result = await expandTask(
				'tasks/tasks.json',
				'2',
				3,
				false,
				'',
				{ mcpLog: createMcpLogMock(), projectRoot: '/mock/project/root' },
				false
			);

			expect(result.task.metadata).toEqual({ taskLinks: links });
			expect(result.task.dependencies).toEqual([]);
		});

		test('should handle research flag correctly', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const numSubtasks = 3;
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(
				tasksPath,
				taskId,
				numSubtasks,
				true, // useResearch = true
				'Additional context for research',
				context,
				false
			);

			// Assert
			expect(generateObjectService).toHaveBeenCalledWith(
				expect.objectContaining({
					role: 'research',
					commandName: expect.any(String)
				})
			);
		});

		test('should handle complexity report integration without errors', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act & Assert - Should complete without errors
			const result = await expandTask(
				tasksPath,
				taskId,
				undefined, // numSubtasks not specified
				false,
				'',
				context,
				false
			);

			// Assert - Should successfully expand and return expected structure
			expect(result).toEqual(
				expect.objectContaining({
					task: expect.objectContaining({
						id: 2,
						subtasks: expect.any(Array)
					}),
					telemetryData: expect.any(Object)
				})
			);
			expect(generateObjectService).toHaveBeenCalled();
		});
	});

	describe('Acceptance criteria', () => {
		const aiSubtask = (id, acceptanceCriteria) => ({
			id,
			title: `Generated subtask ${id}`,
			description: 'A subtask the AI wrote for this test',
			dependencies: [],
			details: 'Implementation details for the generated subtask',
			status: 'pending',
			testStrategy: null,
			acceptanceCriteria
		});

		test('stores the criteria the AI wrote as unchecked items', async () => {
			// Arrange
			generateObjectService.mockResolvedValueOnce({
				mainResult: {
					subtasks: [
						aiSubtask(1, [
							'POST /login returns 401 for a wrong password',
							'  The session cookie is HttpOnly  ',
							''
						]),
						aiSubtask(2, null),
						aiSubtask(3, [])
					]
				},
				telemetryData: {}
			});

			// Act
			await expandTask(
				'tasks/tasks.json',
				'2',
				3,
				false,
				'',
				{ mcpLog: createMcpLogMock(), projectRoot: '/mock/project/root' },
				false
			);

			// Assert
			const parent = writeJSON.mock.calls[0][1].master.tasks.find(
				(t) => t.id === 2
			);
			const [first, second, third] = parent.subtasks.slice(-3);
			expect(first.acceptanceCriteria).toEqual([
				{
					text: 'POST /login returns 401 for a wrong password',
					checked: false
				},
				{ text: 'The session cookie is HttpOnly', checked: false }
			]);
			expect(second).not.toHaveProperty('acceptanceCriteria');
			expect(third).not.toHaveProperty('acceptanceCriteria');
		});

		test('saves subtasks from a response without criteria as before', async () => {
			// Act: the default mock response has no acceptanceCriteria field
			await expandTask(
				'tasks/tasks.json',
				'2',
				3,
				false,
				'',
				{ mcpLog: createMcpLogMock(), projectRoot: '/mock/project/root' },
				false
			);

			// Assert
			const parent = writeJSON.mock.calls[0][1].master.tasks.find(
				(t) => t.id === 2
			);
			expect(parent.subtasks.length).toBeGreaterThan(0);
			for (const subtask of parent.subtasks) {
				expect(subtask).not.toHaveProperty('acceptanceCriteria');
			}
		});
	});

	describe('Tag Handling (The Critical Bug Fix)', () => {
		test('should preserve tagged structure when expanding with default tag', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root',
				tag: 'master' // Explicit tag context
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - CRITICAL: Check tag is passed to readJSON and writeJSON
			expect(readJSON).toHaveBeenCalledWith(
				tasksPath,
				'/mock/project/root',
				'master'
			);
			expect(updateTagTasks).toHaveBeenCalledWith(
				tasksPath,
				'master',
				expect.any(Function)
			);
			expect(writeJSON.mock.calls[0][1]).toEqual(
				expect.objectContaining({
					master: expect.any(Object),
					'feature-branch': expect.any(Object)
				})
			);
		});

		test('should preserve tagged structure when expanding with non-default tag', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '1'; // Task in feature-branch
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root',
				tag: 'feature-branch' // Different tag context
			};

			// Configure readJSON to return feature-branch data
			readJSON.mockImplementation((tasksPath, projectRoot, tag) => {
				const sampleTasksCopy = JSON.parse(JSON.stringify(sampleTasks));
				return {
					...sampleTasksCopy['feature-branch'],
					tag: 'feature-branch',
					_rawTaggedData: sampleTasksCopy
				};
			});

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - CRITICAL: Check tag preservation for non-default tag
			expect(readJSON).toHaveBeenCalledWith(
				tasksPath,
				'/mock/project/root',
				'feature-branch'
			);
			expect(updateTagTasks).toHaveBeenCalledWith(
				tasksPath,
				'feature-branch',
				expect.any(Function)
			);
			expect(writeJSON.mock.calls[0][1]).toEqual(
				expect.objectContaining({
					master: expect.any(Object),
					'feature-branch': expect.any(Object)
				})
			);
		});

		test('should NOT corrupt tagged structure when tag is undefined', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
				// No tag specified - should default gracefully
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Should still preserve structure with undefined tag
			expect(readJSON).toHaveBeenCalledWith(
				tasksPath,
				'/mock/project/root',
				undefined
			);
			expect(updateTagTasks).toHaveBeenCalledWith(
				tasksPath,
				'master',
				expect.any(Function)
			);
			expect(writeJSON.mock.calls[0][1]).toEqual(
				expect.objectContaining({ master: expect.any(Object) })
			);
		});
	});

	describe('Force Flag Handling', () => {
		test('should replace existing subtasks when force=true', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '4'; // Task with existing subtasks
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, true);

			// Assert - Should replace existing subtasks
			const task4 = writeJSON.mock.calls[0][1].master.tasks.find(
				(t) => t.id === 4
			);
			// The existing subtask is gone and the new ones took its place
			expect(task4.subtasks).toHaveLength(3);
			expect(task4.subtasks[0]).toEqual(
				expect.objectContaining({
					id: 1,
					title: 'Set up project structure'
				})
			);
		});

		test('should append to existing subtasks when force=false', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '4'; // Task with existing subtasks
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Verify generateObjectService was called correctly
			expect(generateObjectService).toHaveBeenCalledWith(
				expect.objectContaining({
					role: 'main',
					commandName: 'expand-task',
					objectName: 'subtasks'
				})
			);

			// Assert - Verify data was written with appended subtasks
			expect(writeJSON).toHaveBeenCalled();
			const writeCall = writeJSON.mock.calls[0];
			const savedData = writeCall[1]; // Second argument is the data
			const task4 = savedData.master.tasks.find((t) => t.id === 4);

			// Should have 4 subtasks total (1 existing + 3 new)
			expect(task4.subtasks).toHaveLength(4);

			// Verify existing subtask is preserved at index 0
			expect(task4.subtasks[0]).toEqual(
				expect.objectContaining({
					id: 1,
					title: 'Existing subtask'
				})
			);

			// Verify new subtasks were appended (they start with id=1 from AI)
			expect(task4.subtasks[1]).toEqual(
				expect.objectContaining({
					id: 1,
					title: 'Set up project structure'
				})
			);
		});
	});

	describe('Complexity Report Integration (Tag-Specific)', () => {
		test('should use tag-specific complexity report when available', async () => {
			// Arrange
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt: 'Generate exactly 5 subtasks for complexity report',
				userPrompt:
					'Please break this task into 5 parts\n\nUser provided context'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			const tasksPath = 'tasks/tasks.json';
			const taskId = '1'; // Task in feature-branch
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root',
				tag: 'feature-branch',
				complexityReportPath:
					'/mock/project/root/task-complexity-report_feature-branch.json'
			};

			// Stub fs.existsSync to simulate complexity report exists for this tag
			const existsSpy = vi
				.spyOn(fs, 'existsSync')
				.mockImplementation((filepath) =>
					filepath.endsWith('task-complexity-report_feature-branch.json')
				);

			// Stub readJSON to return complexity report when reading the report path
			readJSON.mockImplementation((filepath, projectRootParam, tagParam) => {
				if (filepath.includes('task-complexity-report_feature-branch.json')) {
					return {
						complexityAnalysis: [
							{
								taskId: 1,
								complexityScore: 8,
								recommendedSubtasks: 5,
								reasoning: 'Needs five detailed steps',
								expansionPrompt: 'Please break this task into 5 parts'
							}
						]
					};
				}
				// Default tasks data for tasks.json
				const sampleTasksCopy = JSON.parse(JSON.stringify(sampleTasks));
				const selectedTag = tagParam || 'master';
				return {
					...sampleTasksCopy[selectedTag],
					tag: selectedTag,
					_rawTaggedData: sampleTasksCopy
				};
			});

			// Act
			await expandTask(tasksPath, taskId, undefined, false, '', context, false);

			// Assert - generateObjectService called with systemPrompt for 5 subtasks
			const callArg = generateObjectService.mock.calls[0][0];
			expect(callArg.systemPrompt).toContain('Generate exactly 5 subtasks');

			// Assert - Should use complexity-report variant with expansion prompt
			expect(mockLoadPrompt).toHaveBeenCalledWith(
				'expand-task',
				expect.objectContaining({
					subtaskCount: 5,
					expansionPrompt: 'Please break this task into 5 parts'
				}),
				'complexity-report'
			);

			// Clean up stub
			existsSpy.mockRestore();
		});

		describe('recommendedSubtasks of 0 (#1728)', () => {
			const reportPath = '/mock/project/root/task-complexity-report.json';
			let existsSpy;

			beforeEach(() => {
				existsSpy = vi
					.spyOn(fs, 'existsSync')
					.mockImplementation((filepath) => filepath === reportPath);
				readJSON.mockImplementation((filepath, projectRootParam, tagParam) => {
					if (filepath === reportPath) {
						return {
							complexityAnalysis: [
								{
									taskId: 1,
									complexityScore: 2,
									recommendedSubtasks: 0,
									reasoning: 'Simple enough, no expansion needed'
								}
							]
						};
					}
					const sampleTasksCopy = JSON.parse(JSON.stringify(sampleTasks));
					const selectedTag = tagParam || 'master';
					return {
						...sampleTasksCopy[selectedTag],
						tag: selectedTag,
						_rawTaggedData: sampleTasksCopy
					};
				});
			});

			afterEach(() => {
				existsSpy.mockRestore();
			});

			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root',
				tag: 'master',
				complexityReportPath: reportPath
			};

			test('should skip expansion without an AI call when the report recommends 0', async () => {
				const result = await expandTask(
					'tasks/tasks.json',
					'1',
					undefined,
					false,
					'',
					context,
					false
				);

				expect(result.skipped).toBe(true);
				expect(generateObjectService).not.toHaveBeenCalled();
			});

			test('should still expand when an explicit subtask count outranks the report', async () => {
				const result = await expandTask(
					'tasks/tasks.json',
					'1',
					3,
					false,
					'',
					context,
					false
				);

				expect(result.skipped).toBeUndefined();
				expect(generateObjectService).toHaveBeenCalled();
			});
		});
	});

	describe('Error Handling', () => {
		test('should handle non-existent task ID', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '999'; // Non-existent task
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			findTaskById.mockReturnValue(null);

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow('Task 999 not found');

			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('should expand tasks regardless of status (including done tasks)', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '1'; // Task with 'done' status
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			const result = await expandTask(
				tasksPath,
				taskId,
				3,
				false,
				'',
				context,
				false
			);

			// Assert - Should successfully expand even 'done' tasks
			expect(writeJSON).toHaveBeenCalled();
			expect(result).toEqual(
				expect.objectContaining({
					task: expect.objectContaining({
						id: 1,
						status: 'done', // Status unchanged
						subtasks: expect.arrayContaining([
							expect.objectContaining({
								id: 1,
								title: 'Set up project structure',
								status: 'pending'
							})
						])
					}),
					telemetryData: expect.any(Object)
				})
			);
		});

		test('should handle AI service failures', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			generateObjectService.mockRejectedValueOnce(
				new Error('AI service error')
			);

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow('AI service error');

			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('should handle missing mainResult from AI response', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Mock AI service returning response without mainResult
			generateObjectService.mockResolvedValueOnce({
				telemetryData: { inputTokens: 100, outputTokens: 50 }
				// Missing mainResult
			});

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow('AI response did not include a valid subtasks array.');

			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('should handle invalid subtasks array from AI response', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Mock AI service returning response with invalid subtasks
			generateObjectService.mockResolvedValueOnce({
				mainResult: {
					subtasks: 'not-an-array' // Invalid: should be an array
				},
				telemetryData: { inputTokens: 100, outputTokens: 50 }
			});

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow('AI response did not include a valid subtasks array.');

			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('should handle file read errors', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			readJSON.mockImplementation(() => {
				throw new Error('File read failed');
			});

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow('File read failed');

			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('should handle invalid tasks data', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			readJSON.mockReturnValue(null);

			// Act & Assert
			await expect(
				expandTask(tasksPath, taskId, 3, false, '', context, false)
			).rejects.toThrow();
		});
	});

	describe('Output Format Handling', () => {
		test('should display telemetry for CLI output format', async () => {
			// Arrange
			const { displayAiUsageSummary } = await import(
				'../../../../../scripts/modules/ui.js'
			);
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				projectRoot: '/mock/project/root'
				// No mcpLog - should trigger CLI mode
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Should display telemetry for CLI users
			expect(displayAiUsageSummary).toHaveBeenCalledWith(
				expect.objectContaining({
					commandName: 'expand-task',
					modelUsed: 'claude-3-5-sonnet',
					totalCost: 0.012414
				}),
				'cli'
			);
		});

		test('should not display telemetry for MCP output format', async () => {
			// Arrange
			const { displayAiUsageSummary } = await import(
				'../../../../../scripts/modules/ui.js'
			);
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Should NOT display telemetry for MCP (handled at higher level)
			expect(displayAiUsageSummary).not.toHaveBeenCalled();
		});
	});

	describe('Edge Cases', () => {
		test('should handle empty additional context', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Should work with empty context (but may include project context)
			expect(generateObjectService).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringMatching(/.*/) // Just ensure prompt exists
				})
			);
		});

		test('should handle additional context correctly', async () => {
			// Arrange
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt: 'Mocked system prompt',
				userPrompt: 'Mocked user prompt with context'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const additionalContext = 'Use React hooks and TypeScript';
			const context = {
				mcpLog: createMcpLogMock(),
				projectRoot: '/mock/project/root'
			};

			// Act
			await expandTask(
				tasksPath,
				taskId,
				3,
				false,
				additionalContext,
				context,
				false
			);

			// Assert - Should pass separate context parameters to prompt manager
			expect(mockLoadPrompt).toHaveBeenCalledWith(
				'expand-task',
				expect.objectContaining({
					additionalContext: expect.stringContaining(
						'Use React hooks and TypeScript'
					),
					gatheredContext: expect.stringContaining(
						'Mock project context from files'
					)
				}),
				expect.any(String)
			);

			// Additional assertion to verify the context parameters are passed separately
			const call = mockLoadPrompt.mock.calls[0];
			const parameters = call[1];
			expect(parameters.additionalContext).toContain(
				'Use React hooks and TypeScript'
			);
			expect(parameters.gatheredContext).toContain(
				'Mock project context from files'
			);
		});

		test('should handle missing project root in context', async () => {
			// Arrange
			const tasksPath = 'tasks/tasks.json';
			const taskId = '2';
			const context = {
				mcpLog: createMcpLogMock()
				// No projectRoot in context
			};

			// Act
			await expandTask(tasksPath, taskId, 3, false, '', context, false);

			// Assert - Should derive project root from tasksPath
			expect(findProjectRoot).toHaveBeenCalledWith(tasksPath);
			expect(readJSON).toHaveBeenCalledWith(
				tasksPath,
				'/mock/project/root',
				undefined
			);
		});
	});

	describe('Dynamic Subtask Generation', () => {
		const tasksPath = 'tasks/tasks.json';
		const taskId = 1;
		const context = { session: null, mcpLog: null };

		beforeEach(() => {
			// Reset all mocks
			vi.clearAllMocks();

			// Setup default mocks
			readJSON.mockReturnValue({
				tasks: [
					{
						id: 1,
						title: 'Test Task',
						description: 'A test task',
						status: 'pending',
						subtasks: []
					}
				]
			});

			findTaskById.mockReturnValue({
				id: 1,
				title: 'Test Task',
				description: 'A test task',
				status: 'pending',
				subtasks: []
			});

			findProjectRoot.mockReturnValue('/mock/project/root');
		});

		test('should accept 0 as valid numSubtasks value for dynamic generation', async () => {
			// Act - Call with numSubtasks=0 (should not throw error)
			const result = await expandTask(
				tasksPath,
				taskId,
				0,
				false,
				'',
				context,
				false
			);

			// Assert - Should complete successfully
			expect(result).toBeDefined();
			expect(generateObjectService).toHaveBeenCalled();
		});

		test('should use dynamic prompting when numSubtasks is 0', async () => {
			// Mock getPromptManager to return realistic prompt with dynamic content
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt:
					'You are an AI assistant helping with task breakdown for software development. You need to break down a high-level task into an appropriate number of specific subtasks that can be implemented one by one.',
				userPrompt:
					'Break down this task into an appropriate number of specific subtasks'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			// Act
			await expandTask(tasksPath, taskId, 0, false, '', context, false);

			// Assert - Verify generateObjectService was called
			expect(generateObjectService).toHaveBeenCalled();

			// Get the call arguments to verify the system prompt
			const callArgs = generateObjectService.mock.calls[0][0];
			expect(callArgs.systemPrompt).toContain(
				'an appropriate number of specific subtasks'
			);
		});

		test('should use specific count prompting when numSubtasks is positive', async () => {
			// Mock getPromptManager to return realistic prompt with specific count
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt:
					'You are an AI assistant helping with task breakdown for software development. You need to break down a high-level task into 5 specific subtasks that can be implemented one by one.',
				userPrompt: 'Break down this task into exactly 5 specific subtasks'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			// Act
			await expandTask(tasksPath, taskId, 5, false, '', context, false);

			// Assert - Verify generateObjectService was called
			expect(generateObjectService).toHaveBeenCalled();

			// Get the call arguments to verify the system prompt
			const callArgs = generateObjectService.mock.calls[0][0];
			expect(callArgs.systemPrompt).toContain('5 specific subtasks');
		});

		test('should reject negative numSubtasks values and fallback to default', async () => {
			// Mock getDefaultSubtasks to return a specific value
			getDefaultSubtasks.mockReturnValue(4);

			// Mock getPromptManager to return realistic prompt with default count
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt:
					'You are an AI assistant helping with task breakdown for software development. You need to break down a high-level task into 4 specific subtasks that can be implemented one by one.',
				userPrompt: 'Break down this task into exactly 4 specific subtasks'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			// Act
			await expandTask(tasksPath, taskId, -3, false, '', context, false);

			// Assert - Should use default value instead of negative
			expect(generateObjectService).toHaveBeenCalled();
			const callArgs = generateObjectService.mock.calls[0][0];
			expect(callArgs.systemPrompt).toContain('4 specific subtasks');
		});

		test('should use getDefaultSubtasks when numSubtasks is undefined', async () => {
			// Mock getDefaultSubtasks to return a specific value
			getDefaultSubtasks.mockReturnValue(6);

			// Mock getPromptManager to return realistic prompt with default count
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt:
					'You are an AI assistant helping with task breakdown for software development. You need to break down a high-level task into 6 specific subtasks that can be implemented one by one.',
				userPrompt: 'Break down this task into exactly 6 specific subtasks'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			// Act - Call without specifying numSubtasks (undefined)
			await expandTask(tasksPath, taskId, undefined, false, '', context, false);

			// Assert - Should use default value
			expect(generateObjectService).toHaveBeenCalled();
			const callArgs = generateObjectService.mock.calls[0][0];
			expect(callArgs.systemPrompt).toContain('6 specific subtasks');
		});

		test('should use getDefaultSubtasks when numSubtasks is null', async () => {
			// Mock getDefaultSubtasks to return a specific value
			getDefaultSubtasks.mockReturnValue(7);

			// Mock getPromptManager to return realistic prompt with default count
			const { getPromptManager } = await import('@tm/core');
			const mockLoadPrompt = vi.fn().mockReturnValue({
				systemPrompt:
					'You are an AI assistant helping with task breakdown for software development. You need to break down a high-level task into 7 specific subtasks that can be implemented one by one.',
				userPrompt: 'Break down this task into exactly 7 specific subtasks'
			});
			getPromptManager.mockReturnValue({
				loadPrompt: mockLoadPrompt
			});

			// Act - Call with null numSubtasks
			await expandTask(tasksPath, taskId, null, false, '', context, false);

			// Assert - Should use default value
			expect(generateObjectService).toHaveBeenCalled();
			const callArgs = generateObjectService.mock.calls[0][0];
			expect(callArgs.systemPrompt).toContain('7 specific subtasks');
		});
	});
});
