/**
 * Tests for the add-task.js module
 */
import { vi } from 'vitest';
import { hasCodebaseAnalysis } from '../../../../../scripts/modules/config-manager.js';

// Mock the dependencies before importing the module under test
vi.doMock('../../../../../scripts/modules/utils.js', () => {
	return {
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
		findTaskById: vi.fn((tasks, id) => {
			if (!tasks) return null;
			const allTasks = [];
			const queue = [...tasks];
			while (queue.length > 0) {
				const task = queue.shift();
				allTasks.push(task);
				if (task.subtasks) {
					queue.push(...task.subtasks);
				}
			}
			return allTasks.find((task) => String(task.id) === String(id));
		}),
		getCurrentTag: vi.fn(() => 'master'),
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
		markMigrationForNotice: vi.fn(),
		performCompleteTagMigration: vi.fn(),
		setTasksForTag: vi.fn(),
		getTasksForTag: vi.fn((data, tag) => data[tag]?.tasks || [])
	};
});

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	startLoadingIndicator: vi.fn(),
	stopLoadingIndicator: vi.fn(),
	succeedLoadingIndicator: vi.fn(),
	failLoadingIndicator: vi.fn(),
	warnLoadingIndicator: vi.fn(),
	infoLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			object: {
				title: 'Task from prompt: Create a new authentication system',
				description: 'Task generated from: Create a new authentication system',
				details:
					'Implementation details for task generated from prompt: Create a new authentication system',
				testStrategy: 'Write unit tests to verify functionality',
				dependencies: []
			}
		},
		telemetryData: {
			timestamp: new Date().toISOString(),
			userId: '1234567890',
			commandName: 'add-task',
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
	getDefaultPriority: vi.fn(() => 'medium'),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/utils/contextGatherer.js', () => ({
	default: vi.fn().mockImplementation(function () {
		return {
			gather: vi.fn().mockResolvedValue({
				contextSummary: 'Mock context summary',
				allRelatedTaskIds: [],
				graphVisualization: 'Mock graph'
			})
		};
	})
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockResolvedValue({
			systemPrompt: 'Mocked system prompt',
			userPrompt: 'Mocked user prompt'
		})
	})
}));

// Import the mocked modules
vi.doMock(
	'../../../../../scripts/modules/utils/update-tag-tasks.js',
	async () => {
		const { readJSON, writeJSON } = await import(
			'../../../../../scripts/modules/utils.js'
		);
		return {
			// Same contract as the real one, on top of the mocked read and write
			updateTagTasks: vi.fn(async (filepath, tag, mutate, options = {}) => {
				const data = readJSON(filepath) ?? {};
				if (!data[tag] && options.createWith) data[tag] = options.createWith;
				const result = mutate(data[tag]);
				writeJSON(filepath, data);
				return result;
			})
		};
	}
);

const { readJSON, writeJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);

const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);

// Import the module under test
const { default: addTask } = await import(
	'../../../../../scripts/modules/task-manager/add-task.js'
);

describe('addTask', () => {
	const sampleTasks = {
		master: {
			tasks: [
				{
					id: 1,
					title: 'Task 1',
					description: 'First task',
					status: 'pending',
					dependencies: []
				},
				{
					id: 2,
					title: 'Task 2',
					description: 'Second task',
					status: 'pending',
					dependencies: []
				},
				{
					id: 3,
					title: 'Task 3',
					description: 'Third task',
					status: 'pending',
					dependencies: [1]
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
		readJSON.mockReturnValue(JSON.parse(JSON.stringify(sampleTasks)));

		// Mock console.log to avoid output during tests
		vi.spyOn(console, 'log').mockImplementation(() => {});
	});

	afterEach(() => {
		console.log.mockRestore();
	});

	test('should add a new task using AI', async () => {
		// Arrange
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		const result = await addTask(
			'tasks/tasks.json',
			prompt,
			[],
			'medium',
			context,
			'json'
		);

		// Assert
		expect(readJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			'/mock/project/root',
			'master'
		);
		expect(generateObjectService).toHaveBeenCalledWith(expect.any(Object));
		expect(writeJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 4, // Next ID after existing tasks
							title: expect.stringContaining(
								'Create a new authentication system'
							),
							status: 'pending'
						})
					])
				})
			})
		);
		expect(result).toEqual(
			expect.objectContaining({
				newTaskId: 4,
				telemetryData: expect.any(Object)
			})
		);
	});

	test('stores acceptance criteria given with the task, unchecked', async () => {
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		await addTask(
			'tasks/tasks.json',
			'Create a new authentication system',
			[],
			'medium',
			context,
			'json',
			null,
			false,
			{ acceptanceCriteria: ['Login works', '  ', 'Tokens expire'] }
		);

		const added = writeJSON.mock.calls[0][1].master.tasks.find(
			(t) => t.id === 4
		);
		expect(added.acceptanceCriteria).toEqual([
			{ text: 'Login works', checked: false },
			{ text: 'Tokens expire', checked: false }
		]);
	});

	test('should validate dependencies when adding a task', async () => {
		// Arrange
		const prompt = 'Create a new authentication system';
		const validDependencies = [1, 2]; // These exist in sampleTasks
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		const result = await addTask(
			'tasks/tasks.json',
			prompt,
			validDependencies,
			'medium',
			context,
			'json'
		);

		// Assert
		expect(writeJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 4,
							dependencies: validDependencies
						})
					])
				})
			})
		);
	});

	describe('dependency provenance', () => {
		const aiReturnsDependencies = (dependencies) =>
			generateObjectService.mockResolvedValueOnce({
				mainResult: {
					object: {
						title: 'Task from the AI',
						description: 'Description from the AI',
						details: '',
						testStrategy: '',
						dependencies
					}
				},
				telemetryData: {}
			});

		const addedTask = () =>
			writeJSON.mock.calls[0][1].master.tasks.find((t) => t.id === 4);

		const context = () => ({
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		});

		test('marks dependencies the AI chose as inferred', async () => {
			aiReturnsDependencies([1, 2]);

			await addTask(
				'tasks/tasks.json',
				'A prompt',
				[],
				'medium',
				context(),
				'json'
			);

			expect(addedTask().metadata.dependencySources).toEqual({
				1: 'inferred',
				2: 'inferred'
			});
		});

		test('keeps dependencies the user passed explicit and marks only the extras', async () => {
			aiReturnsDependencies([1, 2]);

			await addTask(
				'tasks/tasks.json',
				'A prompt',
				[1],
				'medium',
				context(),
				'json'
			);

			expect(addedTask().metadata.dependencySources).toEqual({ 2: 'inferred' });
		});

		test('characterization: adds no metadata when the user supplied every dependency', async () => {
			aiReturnsDependencies([]);

			await addTask(
				'tasks/tasks.json',
				'A prompt',
				[1],
				'medium',
				context(),
				'json'
			);

			expect(addedTask().dependencies).toEqual([1]);
			expect(addedTask()).not.toHaveProperty('metadata');
		});
	});

	test('should filter out invalid dependencies', async () => {
		// Arrange
		const prompt = 'Create a new authentication system';
		const invalidDependencies = [999]; // Non-existent task ID
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		const result = await addTask(
			'tasks/tasks.json',
			prompt,
			invalidDependencies,
			'medium',
			context,
			'json'
		);

		// Assert
		expect(writeJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 4,
							dependencies: [] // Invalid dependencies should be filtered out
						})
					])
				})
			})
		);
		expect(context.mcpLog.warn).toHaveBeenCalledWith(
			"Task 999 doesn't exist; adding the task without that dependency"
		);
	});

	test('should use specified priority', async () => {
		// Arrange
		const prompt = 'Create a new authentication system';
		const priority = 'high';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		await addTask('tasks/tasks.json', prompt, [], priority, context, 'json');

		// Assert
		expect(writeJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							priority: priority
						})
					])
				})
			})
		);
	});

	test('should handle empty tasks file', async () => {
		// Arrange
		readJSON.mockReturnValue({ master: { tasks: [] } });
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		const result = await addTask(
			'tasks/tasks.json',
			prompt,
			[],
			'medium',
			context,
			'json'
		);

		// Assert
		expect(result.newTaskId).toBe(1); // First task should have ID 1
		expect(writeJSON).toHaveBeenCalledWith(
			'tasks/tasks.json',
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 1
						})
					])
				})
			})
		);
	});

	test('should handle missing tasks file', async () => {
		// Arrange
		readJSON.mockReturnValue(null);
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act
		const result = await addTask(
			'tasks/tasks.json',
			prompt,
			[],
			'medium',
			context,
			'json'
		);

		// Assert
		expect(result.newTaskId).toBe(1); // First task should have ID 1
		expect(writeJSON).toHaveBeenCalledTimes(1); // Should create file and add task in one go.
	});

	test('should handle AI service errors', async () => {
		// Arrange
		generateObjectService.mockRejectedValueOnce(new Error('AI service failed'));
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act & Assert
		await expect(
			addTask('tasks/tasks.json', prompt, [], 'medium', context, 'json')
		).rejects.toThrow('AI service failed');
	});

	test('should handle file read errors', async () => {
		// Arrange
		readJSON.mockImplementation(() => {
			throw new Error('File read failed');
		});
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act & Assert
		await expect(
			addTask('tasks/tasks.json', prompt, [], 'medium', context, 'json')
		).rejects.toThrow('File read failed');
	});

	test('should handle file write errors', async () => {
		// Arrange
		writeJSON.mockImplementation(() => {
			throw new Error('File write failed');
		});
		const prompt = 'Create a new authentication system';
		const context = {
			mcpLog: createMcpLogMock(),
			projectRoot: '/mock/project/root',
			tag: 'master'
		};

		// Act & Assert
		await expect(
			addTask('tasks/tasks.json', prompt, [], 'medium', context, 'json')
		).rejects.toThrow('File write failed');
	});
});
