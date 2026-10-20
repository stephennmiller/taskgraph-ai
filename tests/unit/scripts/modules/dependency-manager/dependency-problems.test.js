/**
 * What validate-dependencies reports and fix-dependencies changes, run
 * against the real helpers with only tasks.json reads and writes mocked.
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
	fixDependenciesCommand,
	validateDependenciesCommand,
	validateTaskDependencies
} from '../../../../../scripts/modules/dependency-manager.js';

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

/** Run fix-dependencies on these tasks; return its result and what it wrote */
async function fix(tasks) {
	readJSON.mockReturnValue({ tasks: structuredClone(tasks) });
	const result = await fixDependenciesCommand('tasks.json', {
		context: { projectRoot: '/project', tag: 'master' }
	});
	const written = writeJSON.mock.calls[0]?.[1]?.tasks;
	return { result, written };
}

describe('validate-dependencies', () => {
	it('reports a self-dependency once, not again as a loop', () => {
		const { issues } = validateTaskDependencies([task(1), task(4, [4])]);
		expect(issues.map((issue) => issue.type)).toEqual(['self']);
	});

	it('reads a bare number in a subtask as a sibling subtask', () => {
		const { issues } = validateTaskDependencies([
			task(1, [], [subtask(1, [7])]),
			task(7)
		]);
		expect(issues).toEqual([
			expect.objectContaining({
				type: 'missing',
				taskId: '1.1',
				dependencyId: '1.7'
			})
		]);
	});

	it('returns the problems and counts instead of printing them', async () => {
		readJSON.mockReturnValue({ tasks: [task(1), task(2, [1, 99])] });
		const result = await validateDependenciesCommand('tasks.json', {
			context: { projectRoot: '/project', tag: 'master' }
		});
		expect(result).toEqual({
			valid: false,
			issues: [
				expect.objectContaining({
					type: 'missing',
					taskId: 2,
					dependencyId: 99
				})
			],
			taskCount: 2,
			subtaskCount: 0,
			dependencyCount: 2
		});
	});
});

describe('fix-dependencies', () => {
	beforeEach(() => {
		readJSON.mockReset();
		writeJSON.mockReset();
	});

	it("removes a task's dependency on itself as well as missing ones", async () => {
		const { result, written } = await fix([task(1), task(4, [99, 4])]);

		expect(result.fixes).toEqual([
			{ type: 'missing', taskId: 4, dependencyId: 99 },
			{ type: 'self', taskId: 4 }
		]);
		expect(result.remaining).toEqual([]);
		expect(written[1].dependencies).toEqual([]);
	});

	it('breaks a loop between subtasks by removing one edge', async () => {
		const { result, written } = await fix([
			task(1, [], [subtask(1), subtask(2, [3]), subtask(3, [2])])
		]);

		expect(result.fixes).toEqual([
			{ type: 'circular', taskId: '1.2', dependencyId: '1.3' }
		]);
		expect(result.remaining).toEqual([]);
		expect(written[0].subtasks.map((s) => s.dependencies)).toEqual([
			[],
			[],
			[2]
		]);
	});

	it('keeps a subtask dependency on a task stored as a string', async () => {
		// add-dependency stores "2" for task 2; there is no subtask 1.2
		const { result } = await fix([task(1, [], [subtask(1, ['2'])]), task(2)]);

		expect(result.fixes).toEqual([]);
		expect(result.changed).toBe(false);
		expect(writeJSON).not.toHaveBeenCalled();
	});

	it('leaves a loop between tasks for the user and reports it', async () => {
		const { result } = await fix([task(1), task(2, [3]), task(3, [2])]);

		expect(result.fixes).toEqual([]);
		expect(result.remaining.map((issue) => [issue.type, issue.taskId])).toEqual(
			[
				['circular', 2],
				['circular', 3]
			]
		);
	});

	it('removes duplicates and counts what is left', async () => {
		const { result } = await fix([task(1), task(2, [1, 1])]);

		expect(result.fixes).toEqual([
			{ type: 'duplicate', taskId: 2, dependencyId: 1 }
		]);
		expect(result).toMatchObject({
			taskCount: 2,
			subtaskCount: 0,
			dependencyCount: 1
		});
	});
});
