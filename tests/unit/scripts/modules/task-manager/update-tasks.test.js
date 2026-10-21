/**
 * Tests for the update-tasks.js module
 */
import { vi } from 'vitest';

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
	getCurrentTag: vi.fn(() => 'master'),
	ensureTagMetadata: vi.fn((tagObj) => tagObj),
	flattenTasksWithSubtasks: vi.fn((tasks) => tasks),
	findProjectRoot: vi.fn(() => '/mock/project/root')
}));

vi.doMock('../../../../../scripts/modules/ai-services-unified.js', () => ({
	generateTextService: vi.fn().mockResolvedValue({
		mainResult: '[]', // mainResult is the text string directly
		telemetryData: {}
	}),
	generateObjectService: vi.fn().mockResolvedValue({
		mainResult: {
			tasks: [] // generateObject returns structured data
		},
		telemetryData: {}
	})
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	getStatusWithColor: vi.fn((status) => status),
	startLoadingIndicator: vi.fn(),
	stopLoadingIndicator: vi.fn(),
	displayAiUsageSummary: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false),
	hasCodebaseAnalysis: vi.fn(() => false)
}));

vi.doMock('../../../../../scripts/modules/prompt-manager.js', () => ({
	getPromptManager: vi.fn().mockReturnValue({
		loadPrompt: vi.fn().mockResolvedValue({
			systemPrompt: 'Mocked system prompt',
			userPrompt: 'Mocked user prompt'
		})
	})
}));

vi.doMock('../../../../../scripts/modules/task-manager/models.js', () => ({
	getModelConfiguration: vi.fn(() => ({
		model: 'mock-model',
		maxTokens: 4000,
		temperature: 0.7
	}))
}));

// Import the mocked modules
const { readJSON, writeJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);

const { generateObjectService } = await import(
	'../../../../../scripts/modules/ai-services-unified.js'
);

// Import the module under test
const { default: updateTasks } = await import(
	'../../../../../scripts/modules/task-manager/update-tasks.js'
);

describe('updateTasks', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test('should update tasks based on new context', async () => {
		// Arrange
		const mockTasksPath = '/mock/path/tasks.json';
		const mockFromId = 2;
		const mockPrompt = 'New project direction';
		const mockInitialTasks = {
			master: {
				tasks: [
					{
						id: 1,
						title: 'Old Task 1',
						status: 'done',
						details: 'Done details'
					},
					{
						id: 2,
						title: 'Old Task 2',
						status: 'pending',
						details: 'Old details 2'
					},
					{
						id: 3,
						title: 'Old Task 3',
						status: 'in-progress',
						details: 'Old details 3'
					}
				]
			}
		};

		const mockUpdatedTasks = [
			{
				id: 2,
				title: 'Updated Task 2',
				status: 'pending',
				details: 'New details 2 based on direction',
				description: 'Updated description',
				dependencies: [],
				priority: 'medium',
				testStrategy: 'Unit test the updated functionality',
				subtasks: []
			},
			{
				id: 3,
				title: 'Updated Task 3',
				status: 'pending',
				details: 'New details 3 based on direction',
				description: 'Updated description',
				dependencies: [],
				priority: 'medium',
				testStrategy: 'Integration test the updated features',
				subtasks: []
			}
		];

		const mockApiResponse = {
			mainResult: {
				tasks: mockUpdatedTasks // generateObject returns structured data
			},
			telemetryData: {}
		};

		// Configure mocks - readJSON should return the resolved view with tasks at top level
		readJSON.mockReturnValue({
			...mockInitialTasks.master,
			tag: 'master',
			_rawTaggedData: mockInitialTasks
		});
		generateObjectService.mockResolvedValue(mockApiResponse);

		// Act
		const result = await updateTasks(
			mockTasksPath,
			mockFromId,
			mockPrompt,
			false, // research
			{ projectRoot: '/mock/path', tag: 'master' }, // context
			'json' // output format
		);

		// Assert
		// 1. Read JSON called
		expect(readJSON).toHaveBeenCalledWith(
			mockTasksPath,
			'/mock/path',
			'master'
		);

		// 2. AI Service called with correct args
		expect(generateObjectService).toHaveBeenCalledWith(expect.any(Object));

		// 3. Write JSON called with correctly merged tasks
		expect(writeJSON).toHaveBeenCalledWith(
			mockTasksPath,
			expect.objectContaining({
				_rawTaggedData: expect.objectContaining({
					master: expect.objectContaining({
						tasks: expect.arrayContaining([
							expect.objectContaining({ id: 1 }),
							expect.objectContaining({ id: 2, title: 'Updated Task 2' }),
							expect.objectContaining({ id: 3, title: 'Updated Task 3' })
						])
					})
				})
			}),
			'/mock/path',
			'master'
		);

		// 4. Check return value
		expect(result).toEqual(
			expect.objectContaining({
				success: true,
				updatedTasks: mockUpdatedTasks,
				telemetryData: {}
			})
		);
	});

	test('marks dependencies the AI adds as inferred and keeps earlier marks', async () => {
		const initial = {
			master: {
				tasks: [
					{ id: 1, title: 'One', status: 'done', dependencies: [] },
					{
						id: 2,
						title: 'Two',
						status: 'pending',
						dependencies: [1],
						metadata: { jira: 'ABC-2', dependencySources: { 1: 'inferred' } },
						subtasks: [
							{
								id: 1,
								title: 'Sub',
								status: 'pending',
								dependencies: [],
								metadata: { owner: 'kim' }
							}
						]
					}
				]
			}
		};
		const aiTask = {
			id: 2,
			title: 'Two, revised',
			status: 'pending',
			details: 'd',
			description: 'd',
			dependencies: [1, 3],
			priority: 'medium',
			testStrategy: 't',
			subtasks: [
				{ id: 1, title: 'Sub', status: 'pending', dependencies: [] },
				{ id: 2, title: 'New sub', status: 'pending', dependencies: [1] }
			]
		};
		readJSON.mockReturnValue({
			...initial.master,
			tag: 'master',
			_rawTaggedData: initial
		});
		generateObjectService.mockResolvedValue({
			mainResult: { tasks: [aiTask] },
			telemetryData: {}
		});

		await updateTasks(
			'/mock/path/tasks.json',
			2,
			'Revise',
			false,
			{ projectRoot: '/mock/path', tag: 'master' },
			'json'
		);

		const written = writeJSON.mock.calls[0][1]._rawTaggedData.master.tasks[1];
		expect(written.metadata).toEqual({
			jira: 'ABC-2',
			dependencySources: { 1: 'inferred', 3: 'inferred' }
		});
		expect(written.subtasks[0].metadata).toEqual({ owner: 'kim' });
		// sibling marks are keyed dotted under the parent
		expect(written.subtasks[1].metadata.dependencySources).toEqual({
			2.1: 'inferred'
		});
	});

	const runUpdate = async (initialTasks, aiTasks, fromId = 2) => {
		const initial = { master: { tasks: initialTasks } };
		readJSON.mockReturnValue({
			...initial.master,
			tag: 'master',
			_rawTaggedData: initial
		});
		generateObjectService.mockResolvedValue({
			mainResult: { tasks: aiTasks },
			telemetryData: {}
		});

		await updateTasks(
			'/mock/path/tasks.json',
			fromId,
			'Revise',
			false,
			{ projectRoot: '/mock/path', tag: 'master' },
			'json'
		);

		return writeJSON.mock.calls[0][1]._rawTaggedData.master.tasks;
	};

	test('keeps existing details, priority and test strategy when the AI returns null for them', async () => {
		const written = await runUpdate(
			[
				{
					id: 2,
					title: 'Two',
					status: 'pending',
					dependencies: [],
					priority: 'high',
					details: 'Careful notes the user wrote',
					testStrategy: 'Run the suite'
				}
			],
			[
				{
					id: 2,
					title: 'Two, revised',
					description: 'd',
					status: 'pending',
					dependencies: [],
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: null
				}
			]
		);

		expect(written[0]).toMatchObject({
			title: 'Two, revised',
			priority: 'high',
			details: 'Careful notes the user wrote',
			testStrategy: 'Run the suite'
		});
	});

	test('keeps existing subtasks when the AI returns null for them', async () => {
		const subtasks = [
			{
				id: 1,
				title: 'Finished step',
				status: 'done',
				dependencies: [],
				testStrategy: 'Check it'
			}
		];
		const written = await runUpdate(
			[{ id: 2, title: 'Two', status: 'pending', dependencies: [], subtasks }],
			[
				{
					id: 2,
					title: 'Two, revised',
					description: 'd',
					status: 'pending',
					dependencies: [],
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: null
				}
			]
		);

		expect(written[0].subtasks).toEqual(subtasks);
	});

	test("keeps a subtask's test strategy when the AI returns null for it", async () => {
		const written = await runUpdate(
			[
				{
					id: 2,
					title: 'Two',
					status: 'pending',
					dependencies: [],
					subtasks: [
						{
							id: 1,
							title: 'Step',
							status: 'pending',
							dependencies: [],
							testStrategy: 'Check it'
						}
					]
				}
			],
			[
				{
					id: 2,
					title: 'Two',
					description: 'd',
					status: 'pending',
					dependencies: [],
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: [
						{
							id: 1,
							title: 'Step',
							status: 'pending',
							dependencies: [],
							testStrategy: null
						}
					]
				}
			]
		);

		expect(written[0].subtasks[0].testStrategy).toBe('Check it');
	});

	test('ignores tasks the AI returns that were not sent to it', async () => {
		const written = await runUpdate(
			[
				{ id: 1, title: 'Finished', status: 'done', dependencies: [] },
				{ id: 2, title: 'Two', status: 'pending', dependencies: [] }
			],
			[
				{
					id: 1,
					title: 'Rewritten finished task',
					description: 'd',
					status: 'pending',
					dependencies: [],
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: null
				},
				{
					id: 2,
					title: 'Two, revised',
					description: 'd',
					status: 'pending',
					dependencies: [],
					priority: null,
					details: null,
					testStrategy: null,
					subtasks: null
				}
			]
		);

		expect(written[0]).toMatchObject({ title: 'Finished', status: 'done' });
		expect(written[1].title).toBe('Two, revised');
	});

	test('should handle no tasks to update', async () => {
		// Arrange
		const mockTasksPath = '/mock/path/tasks.json';
		const mockFromId = 99; // Non-existent ID
		const mockPrompt = 'Update non-existent tasks';
		const mockInitialTasks = {
			master: {
				tasks: [
					{ id: 1, status: 'done' },
					{ id: 2, status: 'done' }
				]
			}
		};

		// Configure mocks - readJSON should return the resolved view with tasks at top level
		readJSON.mockReturnValue({
			...mockInitialTasks.master,
			tag: 'master',
			_rawTaggedData: mockInitialTasks
		});

		// Act
		const result = await updateTasks(
			mockTasksPath,
			mockFromId,
			mockPrompt,
			false,
			{ projectRoot: '/mock/path', tag: 'master' },
			'json'
		);

		// Assert
		expect(readJSON).toHaveBeenCalledWith(
			mockTasksPath,
			'/mock/path',
			'master'
		);
		expect(generateObjectService).not.toHaveBeenCalled();
		expect(writeJSON).not.toHaveBeenCalled();
		expect(log).toHaveBeenCalledWith(
			'info',
			expect.stringContaining('No tasks to update')
		);

		// Should return early with no updates
		expect(result).toBeUndefined();
	});

	test('should preserve all tags when updating tasks in tagged context', async () => {
		// Arrange - Simple 2-tag structure to test tag corruption fix
		const mockTasksPath = '/mock/path/tasks.json';
		const mockFromId = 1;
		const mockPrompt = 'Update master tag tasks';

		const mockTaggedData = {
			master: {
				tasks: [
					{
						id: 1,
						title: 'Master Task',
						status: 'pending',
						details: 'Old details'
					},
					{
						id: 2,
						title: 'Master Task 2',
						status: 'done',
						details: 'Done task'
					}
				],
				metadata: {
					created: '2024-01-01T00:00:00.000Z',
					description: 'Master tag tasks'
				}
			},
			'feature-branch': {
				tasks: [
					{
						id: 1,
						title: 'Feature Task',
						status: 'pending',
						details: 'Feature work'
					}
				],
				metadata: {
					created: '2024-01-02T00:00:00.000Z',
					description: 'Feature branch tasks'
				}
			}
		};

		const mockUpdatedTasks = [
			{
				id: 1,
				title: 'Updated Master Task',
				status: 'pending',
				details: 'Updated details',
				description: 'Updated description',
				dependencies: [],
				priority: 'medium',
				testStrategy: 'Test the updated functionality',
				subtasks: []
			}
		];

		// Configure mocks - readJSON returns resolved view for master tag
		readJSON.mockReturnValue({
			...mockTaggedData.master,
			tag: 'master',
			_rawTaggedData: mockTaggedData
		});

		generateObjectService.mockResolvedValue({
			mainResult: {
				tasks: mockUpdatedTasks
			},
			telemetryData: { commandName: 'update-tasks', totalCost: 0.05 }
		});

		// Act
		const result = await updateTasks(
			mockTasksPath,
			mockFromId,
			mockPrompt,
			false, // research
			{ projectRoot: '/mock/project/root', tag: 'master' },
			'json'
		);

		// Assert - CRITICAL: Both tags must be preserved (this would fail before the fix)
		expect(writeJSON).toHaveBeenCalledWith(
			mockTasksPath,
			expect.objectContaining({
				_rawTaggedData: expect.objectContaining({
					master: expect.objectContaining({
						tasks: expect.arrayContaining([
							expect.objectContaining({ id: 1, title: 'Updated Master Task' }),
							expect.objectContaining({ id: 2, title: 'Master Task 2' }) // Unchanged done task
						])
					}),
					// CRITICAL: This tag would be missing/corrupted if the bug existed
					'feature-branch': expect.objectContaining({
						tasks: expect.arrayContaining([
							expect.objectContaining({ id: 1, title: 'Feature Task' })
						]),
						metadata: expect.objectContaining({
							description: 'Feature branch tasks'
						})
					})
				})
			}),
			'/mock/project/root',
			'master'
		);

		expect(result.success).toBe(true);
		expect(result.updatedTasks).toEqual(mockUpdatedTasks);
	});
});
