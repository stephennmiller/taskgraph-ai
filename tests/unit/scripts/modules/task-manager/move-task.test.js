import { vi } from 'vitest';

// --- Mocks ---
// Only mock the specific functions that move-task actually uses
vi.doMock('../../../../../scripts/modules/utils.js', () => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn(),
	log: vi.fn(),
	traverseDependencies: vi.fn(() => [])
}));

vi.doMock(
	'../../../../../scripts/modules/task-manager/is-task-dependent.js',
	() => ({
		default: vi.fn(() => false)
	})
);

vi.doMock('../../../../../scripts/modules/dependency-manager.js', () => ({
	findCrossTagDependencies: vi.fn(() => []),
	getDependentTaskIds: vi.fn(() => []),
	validateSubtaskMove: vi.fn()
}));

const { readJSON, writeJSON, log } = await import(
	'../../../../../scripts/modules/utils.js'
);

const { default: moveTask } = await import(
	'../../../../../scripts/modules/task-manager/move-task.js'
);

const sampleTagged = () => ({
	master: {
		tasks: [
			{ id: 1, title: 'A' },
			{ id: 2, title: 'B', subtasks: [{ id: 1, title: 'B.1' }] }
		],
		metadata: {}
	},
	feature: {
		tasks: [{ id: 10, title: 'X' }],
		metadata: {}
	}
});

const clone = () => JSON.parse(JSON.stringify(sampleTagged()));

describe('moveTask (unit)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readJSON.mockImplementation((path, projectRoot, tag) => {
			const data = clone();
			return { ...data[tag], tag, _rawTaggedData: data };
		});
		writeJSON.mockResolvedValue();
		log.mockImplementation(() => {});
	});

	test('moves task to new ID in same tag', async () => {
		await moveTask('tasks.json', '1', '3', false, { tag: 'master' });
		expect(writeJSON).toHaveBeenCalled();
		const written = writeJSON.mock.calls[0][1];
		const ids = written.master.tasks.map((t) => t.id);
		expect(ids).toEqual(expect.arrayContaining([2, 3]));
		expect(ids).not.toContain(1);
	});

	test('throws when counts of source and dest mismatch', async () => {
		await expect(
			moveTask('tasks.json', '1,2', '3', {}, { tag: 'master' })
		).rejects.toThrow(/Number of source IDs/);
	});

	test('error when tag invalid', async () => {
		await expect(
			moveTask('tasks.json', '1', '2', false, { tag: 'ghost' })
		).rejects.toThrow(/tag "ghost" not found/);
	});

	describe('refuses moves that would lose or duplicate data', () => {
		test('rejects moving a task under its own subtask', async () => {
			await expect(
				moveTask('tasks.json', '1', '1.1', false, { tag: 'master' })
			).rejects.toThrow(/inside itself/);
			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('rejects turning a task that has subtasks into a subtask', async () => {
			await expect(
				moveTask('tasks.json', '2', '1.1', false, { tag: 'master' })
			).rejects.toThrow(/has subtasks/);
			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('rejects a destination subtask ID that already exists', async () => {
			await expect(
				moveTask('tasks.json', '1', '2.1', false, { tag: 'master' })
			).rejects.toThrow(/already exists/);
			expect(writeJSON).not.toHaveBeenCalled();
		});

		test('rejects moving a subtask onto an existing subtask of another parent', async () => {
			readJSON.mockImplementation((path, projectRoot, tag) => {
				const data = clone();
				data.master.tasks.push({
					id: 3,
					title: 'C',
					subtasks: [{ id: 1, title: 'C.1' }]
				});
				return { ...data[tag], tag, _rawTaggedData: data };
			});

			await expect(
				moveTask('tasks.json', '2.1', '3.1', false, { tag: 'master' })
			).rejects.toThrow(/already exists/);
			expect(writeJSON).not.toHaveBeenCalled();
		});
	});
});
