/**
 * What a subtask's dependency names, as the legacy commands read it: a bare
 * number below 100 is a sibling, a dotted string is that subtask, any other
 * string (or a number of 100 or more) is a task. Mirrors
 * `resolveSubtaskDependency` in @tm/core. Only tasks.json I/O is mocked.
 */

import { vi } from 'vitest';

const { readJSON, writeJSON } = vi.hoisted(() => ({
	readJSON: vi.fn(),
	writeJSON: vi.fn()
}));

vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	readJSON,
	writeJSON,
	log: vi.fn()
}));

import {
	addDependency,
	fixDependenciesCommand,
	removeDependency,
	validateTaskDependencies
} from '../../../../../scripts/modules/dependency-manager.js';

const context = { projectRoot: '/project', tag: 'master' };

const task = (id, dependencies = [], subtasks) => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	dependencies,
	...(subtasks ? { subtasks } : {})
});
const subtask = (id, dependencies = []) => ({
	id,
	title: `Subtask ${id}`,
	status: 'pending',
	dependencies
});

describe('subtask dependency rule', () => {
	beforeEach(() => {
		writeJSON.mockClear();
	});
	afterEach(() => vi.restoreAllMocks());

	it('characterization: validate reads a number of 100 or more as a task', () => {
		const { issues } = validateTaskDependencies([
			task(150),
			task(1, [], [subtask(1, [150]), subtask(2, [151])])
		]);

		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing',
				taskId: '1.2',
				dependencyId: 151
			})
		]);
	});

	it('characterization: fix keeps a number of 100 or more that names a task', async () => {
		readJSON.mockReturnValue({
			tasks: [task(150), task(1, [], [subtask(1, [150])])]
		});

		const result = await fixDependenciesCommand('tasks.json', { context });

		expect(result.fixes).toEqual([]);
		expect(writeJSON).not.toHaveBeenCalled();
	});

	it('add-dependency finds a loop through a subtask that depends on a task by number', async () => {
		readJSON.mockReturnValue({
			tasks: [task(150), task(2, [], [subtask(1, [150])])]
		});

		await expect(
			addDependency('tasks.json', 150, '2.1', context)
		).rejects.toMatchObject({ code: 'CIRCULAR_DEPENDENCY' });
		expect(writeJSON).not.toHaveBeenCalled();
	});

	it('add-dependency stores a task list in one form, not a string in a list of numbers (#290)', async () => {
		readJSON.mockReturnValue({
			tasks: [task(1), task(2), task(3, [2])]
		});

		await addDependency('tasks.json', '3', '1', context);

		expect(writeJSON.mock.calls[0][1].tasks[2].dependencies).toEqual([
			'1',
			'2'
		]);
	});

	it("add-dependency rewrites a task's mixed list to one form when it adds to it (#290)", async () => {
		readJSON.mockReturnValue({
			tasks: [task(1), task(2), task(3, [], [subtask(1)]), task(4, [2, '1'])]
		});

		await addDependency('tasks.json', '4', '3.1', context);

		expect(writeJSON.mock.calls[0][1].tasks[3].dependencies).toEqual([
			'1',
			'2',
			'3.1'
		]);
	});

	it('add-dependency keeps a task as "1" on a subtask, apart from sibling 1 (#290)', async () => {
		readJSON.mockReturnValue({
			tasks: [task(1), task(2, [], [subtask(1), subtask(2, [1])])]
		});

		await addDependency('tasks.json', '2.2', '1', context);

		expect(
			writeJSON.mock.calls[0][1].tasks[1].subtasks[1].dependencies
		).toEqual([1, '1']);
	});

	it('add-dependency adds sibling 2.1 to a subtask that lists the task "1"', async () => {
		// "1" is task 1, so 2.2 does not yet depend on sibling 2.1
		readJSON.mockReturnValue({
			tasks: [task(1), task(2, [], [subtask(1), subtask(2, ['1'])])]
		});

		await addDependency('tasks.json', '2.2', '2.1', context);

		expect(
			writeJSON.mock.calls[0][1].tasks[1].subtasks[1].dependencies
		).toEqual(['1', '2.1']);
	});

	it('remove-dependency takes out the task, not the sibling with the same number', async () => {
		readJSON.mockReturnValue({
			tasks: [task(1), task(2, [], [subtask(1), subtask(2, [1, '1'])])]
		});

		await removeDependency('tasks.json', '2.2', 1, context);

		expect(
			writeJSON.mock.calls[0][1].tasks[1].subtasks[1].dependencies
		).toEqual([1]);
	});
});
