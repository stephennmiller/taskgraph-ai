/**
 * Tests for the addSubtask function
 */
import { vi } from 'vitest';

// Mock dependencies before importing the module
const mockUtils = {
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	getCurrentTag: vi.fn()
};
const mockTaskManager = {
	isTaskDependentOn: vi.fn()
};
const mockGenerateTaskFiles = vi.fn();

vi.doMock('../../../../../scripts/modules/utils.js', () => mockUtils);
vi.doMock(
	'../../../../../scripts/modules/task-manager.js',
	() => mockTaskManager
);

const addSubtask = (
	await import('../../../../../scripts/modules/task-manager/add-subtask.js')
).default;

describe('addSubtask function', () => {
	const multiTagData = {
		master: {
			tasks: [{ id: 1, title: 'Master Task', subtasks: [] }],
			metadata: { description: 'Master tasks' }
		},
		'feature-branch': {
			tasks: [{ id: 1, title: 'Feature Task', subtasks: [] }],
			metadata: { description: 'Feature tasks' }
		}
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockTaskManager.isTaskDependentOn.mockReturnValue(false);
	});

	test('should add a new subtask and preserve other tags', async () => {
		const context = { projectRoot: '/fake/root', tag: 'feature-branch' };
		const newSubtaskData = { title: 'My New Subtask' };
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [{ id: 1, title: 'Feature Task', subtasks: [] }],
			metadata: { description: 'Feature tasks' }
		});

		await addSubtask('tasks.json', '1', null, newSubtaskData, true, context);

		expect(mockUtils.writeJSON).toHaveBeenCalledWith(
			'tasks.json',
			expect.any(Object),
			'/fake/root',
			'feature-branch'
		);
		const writtenData = mockUtils.writeJSON.mock.calls[0][1];
		const parentTask = writtenData.tasks.find((t) => t.id === 1);
		expect(parentTask.subtasks).toHaveLength(1);
		expect(parentTask.subtasks[0].title).toBe('My New Subtask');
	});

	test('should add a new subtask to a parent task', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [{ id: 1, title: 'Parent Task', subtasks: [] }]
		});
		const context = {};
		const newSubtask = await addSubtask(
			'tasks.json',
			'1',
			null,
			{ title: 'New Subtask' },
			true,
			context
		);
		expect(newSubtask).toBeDefined();
		expect(newSubtask.id).toBe(1);
		expect(newSubtask.parentTaskId).toBe(1);
		expect(mockUtils.writeJSON).toHaveBeenCalled();
		const writeCallArgs = mockUtils.writeJSON.mock.calls[0][1]; // data is the second arg now
		const parentTask = writeCallArgs.tasks.find((t) => t.id === 1);
		expect(parentTask.subtasks).toHaveLength(1);
		expect(parentTask.subtasks[0].title).toBe('New Subtask');
	});

	test('should convert an existing task to a subtask', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [
				{ id: 1, title: 'Parent Task', subtasks: [] },
				{ id: 2, title: 'Existing Task 2', subtasks: [] }
			]
		});
		const context = {};
		const convertedSubtask = await addSubtask(
			'tasks.json',
			'1',
			'2',
			null,
			true,
			context
		);
		expect(convertedSubtask.id).toBe(1);
		expect(convertedSubtask.parentTaskId).toBe(1);
		expect(convertedSubtask.title).toBe('Existing Task 2');
		expect(mockUtils.writeJSON).toHaveBeenCalled();
		const writeCallArgs = mockUtils.writeJSON.mock.calls[0][1];
		const parentTask = writeCallArgs.tasks.find((t) => t.id === 1);
		expect(parentTask.subtasks).toHaveLength(1);
		expect(parentTask.subtasks[0].title).toBe('Existing Task 2');
	});

	test('converted task names its task dependencies as strings and drops the new parent', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [
				{ id: 1, title: 'Parent Task', subtasks: [] },
				{ id: 2, title: 'Dep', subtasks: [] },
				{
					id: 3,
					title: 'Existing Task 3',
					dependencies: [1, 2],
					subtasks: []
				}
			]
		});

		const converted = await addSubtask('tasks.json', '1', '3', null, true, {});

		expect(converted.dependencies).toEqual(['2']);
		const written = mockUtils.writeJSON.mock.calls[0][1];
		expect(
			written.tasks.find((t) => t.id === 1).subtasks[0].dependencies
		).toEqual(['2']);
	});

	test('converted task keeps its inferred marks for the dependencies that stay', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [
				{ id: 1, title: 'Parent Task', subtasks: [] },
				{ id: 2, title: 'Dep', subtasks: [] },
				{
					id: 3,
					title: 'Existing Task 3',
					dependencies: [1, 2],
					metadata: {
						jira: 'A-1',
						dependencySources: { 1: 'inferred', 2: 'inferred' }
					},
					subtasks: []
				}
			]
		});

		const converted = await addSubtask('tasks.json', '1', '3', null, true, {});

		expect(converted.metadata).toEqual({
			jira: 'A-1',
			dependencySources: { 2: 'inferred' }
		});
	});

	test('repoints what depended on the converted task at the new subtask', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [
				{ id: 1, title: 'Parent Task', subtasks: [] },
				{ id: 3, title: 'Existing Task 3', dependencies: [], subtasks: [] },
				{
					id: 4,
					title: 'Dependent',
					dependencies: [3],
					metadata: { dependencySources: { 3: 'inferred' } },
					subtasks: [
						{ id: 1, title: 'S', dependencies: ['3'] },
						{ id: 2, title: 'T', dependencies: [1] }
					]
				}
			]
		});

		await addSubtask('tasks.json', '1', '3', null, true, {});

		const written = mockUtils.writeJSON.mock.calls[0][1];
		const dependent = written.tasks.find((t) => t.id === 4);
		expect(dependent.dependencies).toEqual(['1.1']);
		expect(dependent.metadata.dependencySources).toEqual({ 1.1: 'inferred' });
		// "3" was the task; the bare 1 is sibling 4.1 and stays
		expect(dependent.subtasks[0].dependencies).toEqual(['1.1']);
		expect(dependent.subtasks[1].dependencies).toEqual([1]);
	});

	test('should throw an error if parent task does not exist', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [{ id: 1, title: 'Task 1', subtasks: [] }]
		});
		const context = {};
		await expect(
			addSubtask(
				'tasks.json',
				'99',
				null,
				{ title: 'New Subtask' },
				true,
				context
			)
		).rejects.toThrow('Parent task with ID 99 not found');
	});

	test('should throw an error if trying to convert a non-existent task', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [{ id: 1, title: 'Parent Task', subtasks: [] }]
		});
		const context = {};
		await expect(
			addSubtask('tasks.json', '1', '99', null, true, context)
		).rejects.toThrow('Task with ID 99 not found');
	});

	test('should throw an error for circular dependency', async () => {
		mockUtils.readJSON.mockReturnValueOnce({
			tasks: [
				{ id: 1, title: 'Parent Task', subtasks: [] },
				{ id: 2, title: 'Child Task', subtasks: [] }
			]
		});
		mockTaskManager.isTaskDependentOn.mockImplementation(
			(tasks, parentTask, existingTaskIdNum) => {
				return parentTask.id === 1 && existingTaskIdNum === 2;
			}
		);
		const context = {};
		await expect(
			addSubtask('tasks.json', '1', '2', null, true, context)
		).rejects.toThrow(
			'Cannot create circular dependency: task 1 is already a subtask or dependent of task 2'
		);
	});
});
