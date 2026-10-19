import { vi } from 'vitest';

// --- Mock dependencies BEFORE module import ---
vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	CONFIG: {
		model: 'mock-model',
		maxTokens: 4000,
		temperature: 0.7,
		debug: false
	},
	findTaskById: vi.fn(),
	truncate: vi.fn((t) => t),
	isSilentMode: vi.fn(() => false)
}));

// fs is used for file deletion side-effects – stub the methods we touch
vi.doMock('fs', () => ({
	existsSync: vi.fn(() => true),
	unlinkSync: vi.fn()
}));

// path is fine to keep as real since only join/dirname used – no side effects

// Import mocked modules
const { readJSON, writeJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);
const fs = await import('fs');

// Import module under test (AFTER mocks in place)
const { default: removeTask } = await import(
	'../../../../../scripts/modules/task-manager/remove-task.js'
);

// ---- Test data helpers ----
const buildSampleTaggedTasks = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'Task 1', status: 'pending', dependencies: [] },
			{ id: 2, title: 'Task 2', status: 'pending', dependencies: [1] },
			{
				id: 3,
				title: 'Parent',
				status: 'pending',
				dependencies: [],
				subtasks: [
					{ id: 1, title: 'Sub 3.1', status: 'pending', dependencies: [] }
				]
			}
		]
	},
	other: {
		tasks: [{ id: 99, title: 'Shadow', status: 'pending', dependencies: [1] }]
	}
});

// Utility to deep clone sample each test
const getFreshData = () => JSON.parse(JSON.stringify(buildSampleTaggedTasks()));

// ----- Tests -----

describe('removeTask', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// readJSON returns deep copy so each test isolated
		readJSON.mockImplementation(() => {
			return {
				...getFreshData().master,
				tag: 'master',
				_rawTaggedData: getFreshData()
			};
		});
		writeJSON.mockResolvedValue();
		log.mockImplementation(() => {});
		fs.unlinkSync.mockImplementation(() => {});
	});

	test('removes a main task and cleans dependencies across tags', async () => {
		const result = await removeTask('tasks/tasks.json', '1', { tag: 'master' });

		// Expect success true
		expect(result.success).toBe(true);
		// writeJSON called with data where task 1 is gone in master & dependencies removed in other tags
		const written = writeJSON.mock.calls[0][1];
		expect(written.master.tasks.find((t) => t.id === 1)).toBeUndefined();
		// deps removed from child tasks
		const task2 = written.master.tasks.find((t) => t.id === 2);
		expect(task2.dependencies).not.toContain(1);
		const shadow = written.other.tasks.find((t) => t.id === 99);
		expect(shadow.dependencies).not.toContain(1);
		// Task file deletion attempted
		expect(fs.unlinkSync).toHaveBeenCalled();
	});

	test('removes a subtask only and leaves parent intact', async () => {
		const result = await removeTask('tasks/tasks.json', '3.1', {
			tag: 'master'
		});

		expect(result.success).toBe(true);
		const written = writeJSON.mock.calls[0][1];
		const parent = written.master.tasks.find((t) => t.id === 3);
		expect(parent.subtasks || []).toHaveLength(0);
		// Ensure parent still exists
		expect(parent).toBeDefined();
		// No task files should be deleted for subtasks
		expect(fs.unlinkSync).not.toHaveBeenCalled();
	});

	test('handles non-existent task gracefully', async () => {
		const result = await removeTask('tasks/tasks.json', '42', {
			tag: 'master'
		});
		expect(result.success).toBe(false);
		expect(result.error).toContain('not found');
		// writeJSON not called because nothing changed
		expect(writeJSON).not.toHaveBeenCalled();
	});
});
