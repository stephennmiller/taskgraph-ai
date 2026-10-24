import { vi } from 'vitest';

vi.doMock('fs', () => {
	const mockFs = {
		existsSync: vi.fn(() => true),
		writeFileSync: vi.fn(),
		readFileSync: vi.fn(),
		unlinkSync: vi.fn()
	};
	return { default: mockFs, ...mockFs };
});

vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	isSilentMode: vi.fn(() => false),
	findProjectRoot: vi.fn(() => '/project'),
	flattenTasksWithSubtasks: vi.fn(() => []),
	truncate: vi.fn((t) => t),
	isEmpty: vi.fn(() => false),
	resolveEnvVariable: vi.fn(),
	findTaskById: vi.fn(),
	getCurrentTag: vi.fn(() => 'master'),
	resolveTag: vi.fn(() => 'master'),
	addComplexityToTask: vi.fn((task, complexity) => ({ ...task, complexity })),
	ensureTagMetadata: vi.fn((tagObj) => tagObj)
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	displayBanner: vi.fn(),
	getStatusWithColor: vi.fn((s) => s),
	startLoadingIndicator: vi.fn(() => ({ stop: vi.fn() })),
	stopLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn(),
	displayContextAnalysis: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: vi
		.fn()
		.mockResolvedValue({ mainResult: { content: '{}' }, telemetryData: {} }),
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			task: {
				id: 1,
				title: 'Updated Task',
				description: 'Updated description',
				status: 'pending',
				dependencies: [],
				priority: 'medium',
				details: null,
				testStrategy: null,
				subtasks: []
			}
		},
		telemetryData: {}
	})
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false),
	isApiKeySet: vi.fn(() => true),
	hasCodebaseAnalysis: vi.fn(() => false)
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

// Mock the prompt manager
vi.doMock('@tm/core', async () => ({
	...(await vi.importActual('@tm/core')),
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn((promptId, params) => ({
			systemPrompt:
				'You are an AI assistant that helps update a software development task with new requirements and information.',
			userPrompt: `Update the following task based on the provided information: ${params?.updatePrompt || 'User prompt for task update'}`,
			metadata: {
				templateId: 'update-task',
				version: '1.0.0',
				variant: 'default',
				parameters: params || {}
			}
		}))
	})
}));

// Mock contextGatherer module
vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	ContextGatherer: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockResolvedValue({
				fullContext: '',
				summary: ''
			})
		};
	})
}));

// Mock fuzzyTaskSearch module
vi.doMock('../../../../../scripts/modules/utils/fuzzyTaskSearch.js', () => ({
	FuzzyTaskSearch: vi.fn().mockImplementation(function () {
		return {
			search: vi.fn().mockReturnValue([]),
			findRelevantTasks: vi.fn().mockReturnValue([]),
			getTaskIds: vi.fn().mockReturnValue([])
		};
	})
}));

const { readJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);
const { createBridgeLogger } = await import(
	'../../../../../scripts/modules/bridge-utils.js'
);
const { getPromptManager } = await import('@tm/core');
const { ContextGatherer } = await import(
	'../../../../../scripts/modules/utils/contextGatherer.js'
);
const { FuzzyTaskSearch } = await import(
	'../../../../../scripts/modules/utils/fuzzyTaskSearch.js'
);
const { default: updateTaskById } = await import(
	'../../../../../scripts/modules/task-manager/update-task-by-id.js'
);

// Import test fixtures for consistent sample data
import {
	taggedEmptyTasks,
	taggedOneTask
} from '../../../../fixtures/sample-tasks.js';

describe('updateTaskById validation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
	});

	test('throws error if prompt is empty', async () => {
		await expect(
			updateTaskById(
				'tasks/tasks.json',
				1,
				'',
				false,
				{ tag: 'master' },
				'json'
			)
		).rejects.toThrow('Prompt cannot be empty');
	});

	test('throws error if task file missing', async () => {
		const fs = await import('fs');
		fs.existsSync.mockReturnValue(false);
		await expect(
			updateTaskById(
				'tasks/tasks.json',
				1,
				'prompt',
				false,
				{
					tag: 'master'
				},
				'json'
			)
		).rejects.toThrow('Tasks file not found');
	});

	test('throws error when task ID not found', async () => {
		const fs = await import('fs');
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue(taggedEmptyTasks);
		await expect(
			updateTaskById(
				'tasks/tasks.json',
				42,
				'prompt',
				false,
				{
					tag: 'master'
				},
				'json'
			)
		).rejects.toThrow('Task 42 not found');
		// Note: The error is reported through the bridge logger (report),
		// not the log function, so we don't assert on log being called
	});
});

describe('updateTaskById success path with generateObjectService', () => {
	let fs;
	let generateObjectService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
		fs = await import('fs');
		const aiServices = await import(
			'../../../../../scripts/modules/ai-services-unified.js'
		);
		generateObjectService = aiServices.generateObjectService;
	});

	test('successfully updates task with all fields from generateObjectService', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});

		const updatedTaskData = {
			id: 1,
			title: 'Updated Task',
			description: 'Updated description',
			status: 'pending',
			dependencies: [2],
			priority: 'high',
			details: 'New implementation details',
			testStrategy: 'Unit tests required',
			subtasks: [
				{
					id: 1,
					title: 'Subtask 1',
					description: 'First subtask',
					status: 'pending',
					dependencies: []
				}
			]
		};

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: updatedTaskData
			},
			telemetryData: {
				model: 'claude-3-5-sonnet-20241022',
				inputTokens: 100,
				outputTokens: 200
			}
		});

		const result = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Update task with new requirements',
			false,
			{ tag: 'master' },
			'json'
		);

		// Verify generateObjectService was called (not generateTextService)
		expect(generateObjectService).toHaveBeenCalled();
		const callArgs = generateObjectService.mock.calls[0][0];

		// Verify correct arguments were passed
		expect(callArgs).toMatchObject({
			role: 'main',
			commandName: 'update-task',
			objectName: 'task'
		});
		expect(callArgs.schema).toBeDefined();
		expect(callArgs.systemPrompt).toContain(
			'update a software development task'
		);
		expect(callArgs.prompt).toContain('Update task with new requirements');

		// Verify the returned task contains all expected fields
		expect(result).toEqual({
			updatedTask: expect.objectContaining({
				id: 1,
				title: 'Updated Task',
				description: 'Updated description',
				status: 'pending',
				dependencies: [2],
				priority: 'high',
				details: 'New implementation details',
				testStrategy: 'Unit tests required',
				subtasks: expect.arrayContaining([
					expect.objectContaining({
						id: 1,
						title: 'Subtask 1',
						description: 'First subtask',
						status: 'pending'
					})
				])
			}),
			telemetryData: expect.objectContaining({
				model: 'claude-3-5-sonnet-20241022',
				inputTokens: 100,
				outputTokens: 200
			}),
			tagInfo: undefined
		});
	});

	test('marks dependencies the AI adds as inferred and keeps earlier marks and user metadata', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [3, 4],
					metadata: { jira: 'ABC-1', dependencySources: { 3: 'inferred' } },
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});
		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'pending',
					dependencies: [3, 4, 5],
					priority: 'high',
					details: 'New details',
					testStrategy: 'Tests',
					subtasks: []
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Add a dependency',
			false,
			{ tag: 'master' },
			'json'
		);

		expect(updatedTask.metadata).toEqual({
			jira: 'ABC-1',
			dependencySources: { 3: 'inferred', 5: 'inferred' }
		});
	});

	test('keeps subtask marks and marks sibling dependencies the AI adds', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: [
						{ id: 1, title: 'S1', status: 'pending', dependencies: [] },
						{
							id: 2,
							title: 'S2',
							status: 'pending',
							dependencies: [1],
							metadata: {
								owner: 'kim',
								dependencySources: { 1.1: 'inferred' }
							}
						}
					]
				}
			]
		});
		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'pending',
					dependencies: [],
					priority: 'high',
					details: 'd',
					testStrategy: 't',
					subtasks: [
						{ id: 1, title: 'S1', status: 'pending', dependencies: [] },
						{ id: 2, title: 'S2', status: 'pending', dependencies: [1] },
						{ id: 3, title: 'S3', status: 'pending', dependencies: [1, 2] }
					]
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Add a subtask',
			false,
			{ tag: 'master' },
			'json'
		);

		const [, second, third] = updatedTask.subtasks;
		expect(second.metadata).toEqual({
			owner: 'kim',
			dependencySources: { 1.1: 'inferred' }
		});
		expect(third.metadata.dependencySources).toEqual({
			1.1: 'inferred',
			1.2: 'inferred'
		});
	});

	test('ignores a user-supplied dependencySources in metadata (reserved key)', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Original Task',
					description: 'Original description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});
		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'pending',
					dependencies: [],
					priority: 'high',
					details: 'd',
					testStrategy: 't',
					subtasks: []
				}
			},
			telemetryData: {}
		});

		const { updatedTask } = await updateTaskById(
			'tasks/tasks.json',
			1,
			'Retitle',
			false,
			{
				tag: 'master',
				metadata: { owner: 'kim', dependencySources: { 9: 'inferred' } }
			},
			'json'
		);

		expect(updatedTask.metadata).toEqual({ owner: 'kim' });
	});

	test('handles generateObjectService with malformed mainResult', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Task',
					description: 'Description',
					status: 'pending',
					dependencies: [],
					priority: 'medium',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: null // Malformed: task is null
			},
			telemetryData: {}
		});

		await expect(
			updateTaskById(
				'tasks/tasks.json',
				1,
				'Update task',
				false,
				{ tag: 'master' },
				'json'
			)
		).rejects.toThrow('Received invalid task object from AI');
	});

	test('handles generateObjectService with missing required fields', async () => {
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Task',
					description: 'Description',
					status: 'pending',
					dependencies: [],
					priority: 'medium',
					details: null,
					testStrategy: null,
					subtasks: []
				}
			]
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					// Missing title and description
					status: 'pending',
					dependencies: [],
					priority: 'medium'
				}
			},
			telemetryData: {}
		});

		await expect(
			updateTaskById(
				'tasks/tasks.json',
				1,
				'Update task',
				false,
				{ tag: 'master' },
				'json'
			)
		).rejects.toThrow('Updated task missing required fields');
	});
});

describe('Prompt Manager Integration', () => {
	let fs;
	let generateObjectService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
		fs = await import('fs');
		const aiServices = await import(
			'../../../../../scripts/modules/ai-services-unified.js'
		);
		generateObjectService = aiServices.generateObjectService;
	});

	test('should use prompt manager to load update prompts', async () => {
		// Arrange
		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Task',
					description: 'Description',
					status: 'pending',
					dependencies: [],
					priority: 'medium',
					details: 'Details',
					testStrategy: 'Test strategy',
					subtasks: []
				}
			]
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'in-progress',
					dependencies: [],
					priority: 'high',
					details: 'Updated details',
					testStrategy: 'Updated test strategy',
					subtasks: []
				}
			},
			telemetryData: {}
		});

		// Act
		await updateTaskById(
			'tasks/tasks.json',
			1,
			'Update this task with new requirements',
			false,
			{ tag: 'master', projectRoot: '/mock/project' },
			'json'
		);

		// Assert - Prompt manager should be called
		expect(getPromptManager).toHaveBeenCalled();
		const promptManagerInstance = getPromptManager.mock.results[0].value;
		expect(promptManagerInstance.loadPrompt).toHaveBeenCalled();
	});
});

describe('Context Gathering Integration', () => {
	let fs;
	let generateObjectService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
		fs = await import('fs');
		const aiServices = await import(
			'../../../../../scripts/modules/ai-services-unified.js'
		);
		generateObjectService = aiServices.generateObjectService;
	});

	test('should gather project context when projectRoot is provided', async () => {
		// Arrange
		const mockContextGatherer = {
			gather: vi.fn().mockResolvedValue({
				fullContext: 'Project context from files',
				summary: 'Context summary'
			})
		};
		ContextGatherer.mockImplementation(function () {
			return mockContextGatherer;
		});

		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Task',
					description: 'Description',
					status: 'pending',
					dependencies: [],
					priority: 'medium',
					details: 'Details',
					testStrategy: 'Test strategy',
					subtasks: []
				}
			]
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'in-progress',
					dependencies: [],
					priority: 'high',
					details: 'Updated details',
					testStrategy: 'Updated test strategy',
					subtasks: []
				}
			},
			telemetryData: {}
		});

		// Act
		await updateTaskById(
			'tasks/tasks.json',
			1,
			'Update with context',
			false,
			{ tag: 'master', projectRoot: '/mock/project' },
			'json'
		);

		// Assert - Context gatherer should be instantiated and used
		expect(ContextGatherer).toHaveBeenCalledWith('/mock/project', 'master');
		expect(mockContextGatherer.gather).toHaveBeenCalled();
	});
});

describe('Fuzzy Task Search Integration', () => {
	let fs;
	let generateObjectService;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.spyOn(process, 'exit').mockImplementation(() => {
			throw new Error('process.exit called');
		});
		fs = await import('fs');
		const aiServices = await import(
			'../../../../../scripts/modules/ai-services-unified.js'
		);
		generateObjectService = aiServices.generateObjectService;
	});

	test('should use fuzzy search to find related tasks for context', async () => {
		// Arrange
		const mockFuzzySearch = {
			findRelevantTasks: vi.fn().mockReturnValue([
				{ id: 2, title: 'Related Task 1', score: 0.9 },
				{ id: 3, title: 'Related Task 2', score: 0.85 }
			]),
			getTaskIds: vi.fn().mockReturnValue(['2', '3'])
		};
		FuzzyTaskSearch.mockImplementation(function () {
			return mockFuzzySearch;
		});

		fs.existsSync.mockReturnValue(true);
		readJSON.mockReturnValue({
			tag: 'master',
			tasks: [
				{
					id: 1,
					title: 'Task to update',
					description: 'Description',
					status: 'pending',
					dependencies: [],
					priority: 'medium',
					details: 'Details',
					testStrategy: 'Test strategy',
					subtasks: []
				},
				{
					id: 2,
					title: 'Related Task 1',
					description: 'Related description',
					status: 'done',
					dependencies: [],
					priority: 'medium',
					details: 'Related details',
					testStrategy: 'Related test strategy',
					subtasks: []
				},
				{
					id: 3,
					title: 'Related Task 2',
					description: 'Another related description',
					status: 'pending',
					dependencies: [],
					priority: 'low',
					details: 'More details',
					testStrategy: 'Test strategy',
					subtasks: []
				}
			]
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				task: {
					id: 1,
					title: 'Updated Task',
					description: 'Updated description',
					status: 'in-progress',
					dependencies: [],
					priority: 'high',
					details: 'Updated details',
					testStrategy: 'Updated test strategy',
					subtasks: []
				}
			},
			telemetryData: {}
		});

		// Act
		await updateTaskById(
			'tasks/tasks.json',
			1,
			'Update with related task context',
			false,
			{ tag: 'master' },
			'json'
		);

		// Assert - Fuzzy search should be instantiated and used
		expect(FuzzyTaskSearch).toHaveBeenCalled();
		expect(mockFuzzySearch.findRelevantTasks).toHaveBeenCalledWith(
			expect.stringContaining('Task to update'),
			expect.objectContaining({
				maxResults: 5,
				includeSelf: true
			})
		);
		expect(mockFuzzySearch.getTaskIds).toHaveBeenCalled();
	});
});
