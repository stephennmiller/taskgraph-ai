/**
 * Tests for the set-task-status.js module
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
	findTaskById: vi.fn((tasks, id) => tasks.find((t) => t.id === parseInt(id))),
	ensureTagMetadata: vi.fn((tagObj) => tagObj),
	getCurrentTag: vi.fn(() => 'master')
}));

vi.doMock('../../../../../scripts/modules/ui.js', () => ({
	formatDependenciesWithStatus: vi.fn(),
	displayBanner: vi.fn(),
	displayTaskList: vi.fn(),
	startLoadingIndicator: vi.fn(() => ({ stop: vi.fn() })),
	stopLoadingIndicator: vi.fn(),
	getStatusWithColor: vi.fn((status) => status)
}));

vi.doMock('../../../../../src/constants/task-status.js', () => ({
	isValidTaskStatus: vi.fn((status) =>
		[
			'pending',
			'done',
			'in-progress',
			'review',
			'deferred',
			'cancelled'
		].includes(status)
	),
	TASK_STATUS_OPTIONS: [
		'pending',
		'done',
		'in-progress',
		'review',
		'deferred',
		'cancelled'
	]
}));

vi.doMock(
	'../../../../../scripts/modules/task-manager/update-single-task-status.js',
	() => ({
		default: vi.fn()
	})
);

vi.doMock('../../../../../scripts/modules/dependency-manager.js', () => ({
	validateTaskDependencies: vi.fn()
}));

vi.doMock('../../../../../scripts/modules/config-manager.js', () => ({
	getDebugFlag: vi.fn(() => false)
}));

// Import the mocked modules
const { readJSON, writeJSON, log, findTaskById } = await import(
	'../../../../../scripts/modules/utils.js'
);

const updateSingleTaskStatus = (
	await import(
		'../../../../../scripts/modules/task-manager/update-single-task-status.js'
	)
).default;

// Import the module under test
const { default: setTaskStatus } = await import(
	'../../../../../scripts/modules/task-manager/set-task-status.js'
);

// Sample data for tests (from main test file) - TAGGED FORMAT
const sampleTasks = {
	master: {
		tasks: [
			{
				id: 1,
				title: 'Task 1',
				description: 'First task description',
				status: 'pending',
				dependencies: [],
				priority: 'high',
				details: 'Detailed information for task 1',
				testStrategy: 'Test strategy for task 1'
			},
			{
				id: 2,
				title: 'Task 2',
				description: 'Second task description',
				status: 'pending',
				dependencies: [1],
				priority: 'medium',
				details: 'Detailed information for task 2',
				testStrategy: 'Test strategy for task 2'
			},
			{
				id: 3,
				title: 'Task with Subtasks',
				description: 'Task with subtasks description',
				status: 'pending',
				dependencies: [1, 2],
				priority: 'high',
				details: 'Detailed information for task 3',
				testStrategy: 'Test strategy for task 3',
				subtasks: [
					{
						id: 1,
						title: 'Subtask 1',
						description: 'First subtask',
						status: 'pending',
						dependencies: [],
						details: 'Details for subtask 1'
					},
					{
						id: 2,
						title: 'Subtask 2',
						description: 'Second subtask',
						status: 'pending',
						dependencies: [1],
						details: 'Details for subtask 2'
					}
				]
			}
		]
	}
};

describe('setTaskStatus', () => {
	beforeEach(() => {
		vi.clearAllMocks();

		// Mock console methods to suppress output
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});

		// Mock process.exit to prevent actual exit
		vi.spyOn(process, 'exit').mockImplementation((code) => {
			throw new Error(`process.exit: ${code}`);
		});

		// Set up updateSingleTaskStatus mock to actually update the data
		updateSingleTaskStatus.mockImplementation(
			async (tasksPath, taskId, newStatus, data) => {
				// This mock now operates on the tasks array passed in the `data` object
				const { tasks } = data;
				// Handle subtask notation (e.g., "3.1")
				if (taskId.includes('.')) {
					const [parentId, subtaskId] = taskId
						.split('.')
						.map((id) => parseInt(id, 10));
					const parentTask = tasks.find((t) => t.id === parentId);
					if (!parentTask) {
						throw new Error(`Parent task ${parentId} not found`);
					}
					if (!parentTask.subtasks) {
						throw new Error(`Parent task ${parentId} has no subtasks`);
					}
					const subtask = parentTask.subtasks.find((st) => st.id === subtaskId);
					if (!subtask) {
						throw new Error(
							`Subtask ${subtaskId} not found in parent task ${parentId}`
						);
					}
					subtask.status = newStatus;
				} else {
					// Handle regular task
					const task = tasks.find((t) => t.id === parseInt(taskId, 10));
					if (!task) {
						throw new Error(`Task ${taskId} not found`);
					}
					task.status = newStatus;

					// If marking parent as done, mark all subtasks as done too
					if (newStatus === 'done' && task.subtasks) {
						task.subtasks.forEach((subtask) => {
							subtask.status = 'done';
						});
					}
				}
			}
		);
	});

	afterEach(() => {
		// Restore console methods
		vi.restoreAllMocks();
	});

	test('should update task status in tasks.json', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act
		await setTaskStatus(tasksPath, '2', 'done', {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 2, status: 'done' })
					])
				})
			}),
			undefined,
			'master'
		);
		// expect(generateTaskFiles).toHaveBeenCalledWith(
		// 	tasksPath,
		// 	expect.any(String),
		// 	expect.any(Object)
		// );
	});

	test('should update subtask status when using dot notation', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act
		await setTaskStatus(tasksPath, '3.1', 'done', {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 3,
							subtasks: expect.arrayContaining([
								expect.objectContaining({ id: 1, status: 'done' })
							])
						})
					])
				})
			}),
			undefined,
			'master'
		);
	});

	test('should update multiple tasks when given comma-separated IDs', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act
		await setTaskStatus(tasksPath, '1,2', 'done', {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({ id: 1, status: 'done' }),
						expect.objectContaining({ id: 2, status: 'done' })
					])
				})
			}),
			undefined,
			'master'
		);
	});

	test('should automatically mark subtasks as done when parent is marked done', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act
		await setTaskStatus(tasksPath, '3', 'done', {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				master: expect.objectContaining({
					tasks: expect.arrayContaining([
						expect.objectContaining({
							id: 3,
							status: 'done',
							subtasks: expect.arrayContaining([
								expect.objectContaining({ id: 1, status: 'done' }),
								expect.objectContaining({ id: 2, status: 'done' })
							])
						})
					])
				})
			}),
			undefined,
			'master'
		);
	});

	test('should throw error for non-existent task ID', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, '99', 'done', {
				tag: 'master',
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow('Task 99 not found');
	});

	test('should throw error for invalid status', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, '2', 'InvalidStatus', {
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow(/Invalid status value: InvalidStatus/);
	});

	test('should handle parent tasks without subtasks when updating subtask', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		// Remove subtasks from task 3
		const { subtasks, ...taskWithoutSubtasks } = testTasksData.master.tasks[2];
		testTasksData.master.tasks[2] = taskWithoutSubtasks;

		const tasksPath = '/mock/path/tasks.json';
		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, '3.1', 'done', {
				tag: 'master',
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow('has no subtasks');
	});

	test('should handle non-existent subtask ID', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, '3.99', 'done', {
				tag: 'master',
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow('Subtask 99 not found');
	});

	test('should handle file read errors', async () => {
		// Arrange
		const tasksPath = 'tasks/tasks.json';
		const taskId = '2';
		const newStatus = 'done';

		readJSON.mockImplementation(() => {
			throw new Error('File not found');
		});

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, taskId, newStatus, {
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow('File not found');

		// Verify that writeJSON was not called due to read error
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should handle empty task ID input', async () => {
		// Arrange
		const tasksPath = 'tasks/tasks.json';
		const emptyTaskId = '';
		const newStatus = 'done';

		// Act & Assert
		await expect(
			setTaskStatus(tasksPath, emptyTaskId, newStatus, {
				mcpLog: { info: vi.fn() }
			})
		).rejects.toThrow();

		// Verify that updateSingleTaskStatus was not called
		expect(updateSingleTaskStatus).not.toHaveBeenCalled();
	});

	test('should handle whitespace in comma-separated IDs', async () => {
		// Arrange
		const testTasksData = JSON.parse(JSON.stringify(sampleTasks));
		const tasksPath = 'tasks/tasks.json';
		const taskIds = ' 1 , 2 , 3 '; // IDs with whitespace
		const newStatus = 'in-progress';

		readJSON.mockReturnValue({
			...testTasksData.master,
			tag: 'master',
			_rawTaggedData: testTasksData
		});

		// Act
		const result = await setTaskStatus(tasksPath, taskIds, newStatus, {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert
		expect(updateSingleTaskStatus).toHaveBeenCalledTimes(3);
		expect(updateSingleTaskStatus).toHaveBeenCalledWith(
			tasksPath,
			'1',
			newStatus,
			expect.objectContaining({
				tasks: expect.any(Array),
				tag: 'master',
				_rawTaggedData: expect.any(Object)
			}),
			false
		);
		expect(updateSingleTaskStatus).toHaveBeenCalledWith(
			tasksPath,
			'2',
			newStatus,
			expect.objectContaining({
				tasks: expect.any(Array),
				tag: 'master',
				_rawTaggedData: expect.any(Object)
			}),
			false
		);
		expect(updateSingleTaskStatus).toHaveBeenCalledWith(
			tasksPath,
			'3',
			newStatus,
			expect.objectContaining({
				tasks: expect.any(Array),
				tag: 'master',
				_rawTaggedData: expect.any(Object)
			}),
			false
		);
		expect(result).toBeDefined();
	});

	// Regression test to ensure tag preservation when updating in multi-tag environment
	test('should preserve other tags when updating task status', async () => {
		// Arrange
		const multiTagData = {
			master: JSON.parse(JSON.stringify(sampleTasks.master)),
			'feature-branch': {
				tasks: [
					{ id: 10, title: 'FB Task', status: 'pending', dependencies: [] }
				],
				metadata: { description: 'Feature branch tasks' }
			}
		};
		const tasksPath = '/mock/path/tasks.json';

		readJSON.mockReturnValue({
			...multiTagData.master, // resolved view not used
			tag: 'master',
			_rawTaggedData: multiTagData
		});

		// Act
		await setTaskStatus(tasksPath, '1', 'done', {
			tag: 'master',
			mcpLog: { info: vi.fn() }
		});

		// Assert: writeJSON should be called with data containing both tags intact
		const writeArgs = writeJSON.mock.calls[0];
		expect(writeArgs[0]).toBe(tasksPath);
		const writtenData = writeArgs[1];
		expect(writtenData).toHaveProperty('master');
		expect(writtenData).toHaveProperty('feature-branch');
		// master task updated
		const updatedTask = writtenData.master.tasks.find((t) => t.id === 1);
		expect(updatedTask.status).toBe('done');
		// feature-branch untouched
		expect(writtenData['feature-branch'].tasks[0].status).toBe('pending');
		// ensure additional args (projectRoot undefined, tag 'master') present
		expect(writeArgs[2]).toBeUndefined();
		expect(writeArgs[3]).toBe('master');
	});
});
