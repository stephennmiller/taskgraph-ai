/**
 * Tests for the clear-subtasks.js module
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
	findTaskById: vi.fn(),
	isSilentMode: vi.fn(() => false),
	truncate: vi.fn((text) => text),
	ensureTagMetadata: vi.fn()
}));

// Mock process.exit to prevent Jest worker crashes
const mockExit = vi.spyOn(process, 'exit').mockImplementation((code) => {
	throw new Error(`process.exit called with "${code}"`);
});

// Import the mocked modules
const { readJSON, writeJSON, log, findTaskById, ensureTagMetadata } =
	await import('../../../../../scripts/modules/utils.js');

// Import the module under test
const { default: clearSubtasks } = await import(
	'../../../../../scripts/modules/task-manager/clear-subtasks.js'
);

describe('clearSubtasks', () => {
	const sampleTasks = {
		master: {
			tasks: [
				{ id: 1, title: 'Task 1', subtasks: [] },
				{ id: 2, title: 'Task 2', subtasks: [] },
				{
					id: 3,
					title: 'Task 3',
					subtasks: [{ id: 1, title: 'Subtask 3.1' }]
				},
				{
					id: 4,
					title: 'Task 4',
					subtasks: [{ id: 1, title: 'Subtask 4.1' }]
				}
			]
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockExit.mockClear();
		readJSON.mockImplementation((tasksPath, projectRoot, tag) => {
			// Ensure tag contract is honoured
			expect(tag).toBeDefined();
			expect(tag).toBe('master');
			// Create a deep copy to avoid mutation issues between tests
			const sampleTasksCopy = JSON.parse(JSON.stringify(sampleTasks));
			// Return the data for the 'master' tag, which is what the tests use
			return {
				...sampleTasksCopy.master,
				tag: tag || 'master',
				_rawTaggedData: sampleTasksCopy
			};
		});
		writeJSON.mockResolvedValue();
		log.mockImplementation(() => {});
	});

	test('should clear subtasks from a specific task', () => {
		// Arrange
		const taskId = '3';
		const tasksPath = 'tasks/tasks.json';
		const context = { tag: 'master' };

		// Act
		clearSubtasks(tasksPath, taskId, context);

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				_rawTaggedData: expect.objectContaining({
					master: expect.objectContaining({
						tasks: expect.arrayContaining([
							expect.objectContaining({
								id: 3,
								subtasks: [] // Should be empty
							})
						])
					})
				})
			}),
			undefined,
			'master'
		);
	});

	test('should clear subtasks from multiple tasks when given comma-separated IDs', () => {
		// Arrange
		const taskIds = '3,4';
		const tasksPath = 'tasks/tasks.json';
		const context = { tag: 'master' };

		// Act
		clearSubtasks(tasksPath, taskIds, context);

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		expect(writeJSON).toHaveBeenCalledWith(
			tasksPath,
			expect.objectContaining({
				_rawTaggedData: expect.objectContaining({
					master: expect.objectContaining({
						tasks: expect.arrayContaining([
							expect.objectContaining({ id: 3, subtasks: [] }),
							expect.objectContaining({ id: 4, subtasks: [] })
						])
					})
				})
			}),
			undefined,
			'master'
		);
	});

	test('should handle tasks with no subtasks', () => {
		// Arrange
		const taskId = '1'; // Task 1 already has no subtasks
		const tasksPath = 'tasks/tasks.json';
		const context = { tag: 'master' };

		// Act
		clearSubtasks(tasksPath, taskId, context);

		// Assert
		expect(readJSON).toHaveBeenCalledWith(tasksPath, undefined, 'master');
		// Should not write the file if no changes were made
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should reject a non-existent task ID', () => {
		// Act & Assert
		expect(() =>
			clearSubtasks('tasks/tasks.json', '99', { tag: 'master' })
		).toThrow(
			expect.objectContaining({
				name: 'ClearSubtasksError',
				code: 'TASK_NOT_FOUND',
				message: 'Task 99 not found'
			})
		);
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should reject a subtask ID instead of clearing its parent', () => {
		// parseInt('3.1') is 3, which used to clear every subtask of task 3
		expect(() =>
			clearSubtasks('tasks/tasks.json', '3.1', { tag: 'master' })
		).toThrow(expect.objectContaining({ code: 'SUBTASK_ID', taskId: '3.1' }));
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should reject an ID that is not a number', () => {
		expect(() =>
			clearSubtasks('tasks/tasks.json', 'abc', { tag: 'master' })
		).toThrow(expect.objectContaining({ code: 'INVALID_TASK_ID' }));
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should return what it cleared and which tasks had no subtasks', () => {
		const result = clearSubtasks('tasks/tasks.json', '1,3,4,3', {
			tag: 'master'
		});

		expect(result).toEqual({
			cleared: [
				{ id: 3, title: 'Task 3', count: 1 },
				{ id: 4, title: 'Task 4', count: 1 }
			],
			empty: [{ id: 1, title: 'Task 1' }]
		});
	});

	test('should clear nothing when one of several IDs is not found', () => {
		// Arrange
		const taskIds = '3,99'; // Mix of valid and invalid IDs
		const tasksPath = 'tasks/tasks.json';
		const context = { tag: 'master' };

		// Act & Assert: a typo in a list changes nothing
		expect(() => clearSubtasks(tasksPath, taskIds, context)).toThrow(
			'Task 99 not found'
		);
		expect(writeJSON).not.toHaveBeenCalled();
	});

	test('should handle file read errors', () => {
		// Arrange
		readJSON.mockImplementation(() => {
			throw new Error('File read failed');
		});

		// Act & Assert
		expect(() => {
			clearSubtasks('tasks/tasks.json', '3', { tag: 'master' });
		}).toThrow('File read failed');
	});

	test('should handle invalid tasks data', () => {
		// Arrange
		readJSON.mockReturnValue(null);

		// Act & Assert
		expect(() => {
			clearSubtasks('tasks/tasks.json', '3', { tag: 'master' });
		}).toThrow(expect.objectContaining({ code: 'NO_TASKS' }));
	});

	test('should handle file write errors', () => {
		// Arrange
		// Ensure task 3 has subtasks to clear so writeJSON gets called
		readJSON.mockReturnValue({
			...sampleTasks.master,
			tag: 'master',
			_rawTaggedData: sampleTasks,
			tasks: [
				...sampleTasks.master.tasks.slice(0, 2),
				{
					...sampleTasks.master.tasks[2],
					subtasks: [{ id: 1, title: 'Subtask to clear' }]
				},
				...sampleTasks.master.tasks.slice(3)
			]
		});

		writeJSON.mockImplementation(() => {
			throw new Error('File write failed');
		});

		// Act & Assert
		expect(() => {
			clearSubtasks('tasks/tasks.json', '3', { tag: 'master' });
		}).toThrow('File write failed');
	});
});
