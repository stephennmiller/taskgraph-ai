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

// The real helper edits the file under a lock; here it edits what the mocked
// readJSON returns and hands the result to writeJSON when something changed
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
				const before = JSON.stringify(raw);
				const result = mutate(raw[tag]);
				if (JSON.stringify(raw) !== before) writeJSON(filepath, raw);
				return result;
			})
		};
	}
);

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

	test('removes a main task and cleans dependencies in its own tag only', async () => {
		const result = await removeTask('tasks/tasks.json', '1', { tag: 'master' });

		// Expect success true
		expect(result.success).toBe(true);
		// writeJSON called with data where task 1 is gone in master & its dependents cleaned
		const written = writeJSON.mock.calls[0][1];
		expect(written.master.tasks.find((t) => t.id === 1)).toBeUndefined();
		// deps removed from child tasks
		const task2 = written.master.tasks.find((t) => t.id === 2);
		expect(task2.dependencies).not.toContain(1);
		// Another tag's dependency 1 names that tag's own task 1
		const shadow = written.other.tasks.find((t) => t.id === 99);
		expect(shadow.dependencies).toContain(1);
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

	describe('subtask dependency references', () => {
		const tagged = () => ({
			master: {
				tasks: [
					{ id: 1, title: 'Task 1', status: 'pending', dependencies: [] },
					{
						id: 2,
						title: 'Parent',
						status: 'pending',
						dependencies: ['1'],
						subtasks: [
							{ id: 1, title: 'Sub 2.1', status: 'pending', dependencies: [] },
							// 1 is sibling 2.1, "1" is task 1
							{
								id: 2,
								title: 'Sub 2.2',
								status: 'pending',
								dependencies: [1, '1', 150]
							}
						]
					}
				]
			}
		});
		const remove = async (id) => {
			readJSON.mockImplementation(() => ({
				...tagged().master,
				tag: 'master',
				_rawTaggedData: tagged()
			}));
			await removeTask('tasks/tasks.json', id, { tag: 'master' });
			const written = writeJSON.mock.calls[0][1];
			return written.master.tasks.find((t) => t.id === 2);
		};

		test('removing a task drops the string naming it, not the sibling with that number', async () => {
			const parent = await remove('1');

			expect(parent.dependencies).toEqual([]);
			expect(parent.subtasks[1].dependencies).toEqual([1, 150]);
		});

		test('removing a subtask drops the sibling number, not the task string', async () => {
			const parent = await remove('2.1');

			expect(parent.dependencies).toEqual(['1']);
			expect(parent.subtasks[0].dependencies).toEqual(['1', 150]);
		});
	});
});
