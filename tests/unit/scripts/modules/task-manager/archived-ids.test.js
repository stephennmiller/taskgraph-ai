/**
 * Archived tasks (`taskgraph archive`) keep their IDs and count as done in
 * the legacy commands: add-task, parse-prd, move and remove-subtask never
 * hand out an archived ID, and validate/fix-dependencies and the MCP
 * next_task treat dependencies on archived tasks as done. Real files in a temp dir; only logging is silenced.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import {
	fixDependenciesCommand,
	validateDependenciesCommand
} from '../../../../../scripts/modules/dependency-manager.js';
import addTask from '../../../../../scripts/modules/task-manager/add-task.js';
import moveTask, {
	moveTasksBetweenTags
} from '../../../../../scripts/modules/task-manager/move-task.js';
import { loadExistingTasks } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';
import removeSubtask from '../../../../../scripts/modules/task-manager/remove-subtask.js';
import removeTask from '../../../../../scripts/modules/task-manager/remove-task.js';
import { nextTaskDirect } from '../../../../../mcp-server/src/core/direct-functions/next-task.js';

// vi.mock is hoisted above the imports: real file I/O, logging silenced
vi.mock('../../../../../scripts/modules/utils.js', async (importOriginal) => ({
	...(await importOriginal()),
	log: vi.fn(),
	isSilentMode: vi.fn(() => true)
}));

const task = (id, extra = {}) => ({
	id,
	title: `Task ${id}`,
	description: `Task ${id}`,
	status: 'pending',
	dependencies: [],
	priority: 'medium',
	subtasks: [],
	...extra
});

const silentLog = {
	info: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	success: vi.fn()
};

describe('archived task IDs in the legacy commands', () => {
	let dir;
	let tasksPath;
	let archivePath;

	const readTasks = (tag = 'master') =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8'))[tag].tasks;

	/** tasks.json holds the live tasks; archive.json the archived ones */
	const setup = (live, archived, extraTags = {}) => {
		fs.writeFileSync(
			tasksPath,
			JSON.stringify({
				master: { tasks: live, metadata: {} },
				...Object.fromEntries(
					Object.entries(extraTags).map(([tag, tasks]) => [
						tag,
						{ tasks, metadata: {} }
					])
				)
			})
		);
		fs.writeFileSync(
			archivePath,
			JSON.stringify({
				master: {
					tasks: archived.map((t) => ({
						...t,
						status: 'done',
						archivedAt: '2026-01-01T00:00:00.000Z'
					})),
					metadata: {
						highestId: Math.max(0, ...archived.map((t) => t.id))
					}
				}
			})
		);
	};

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archived-ids-'));
		fs.mkdirSync(path.join(dir, '.taskgraph', 'tasks'), { recursive: true });
		tasksPath = path.join(dir, '.taskgraph', 'tasks', 'tasks.json');
		archivePath = path.join(dir, '.taskgraph', 'tasks', 'archive.json');
	});

	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	describe('add-task', () => {
		test('numbers a new task above the archived IDs', async () => {
			setup([task(1)], [task(2), task(3)]);

			const result = await addTask(
				tasksPath,
				null,
				[],
				'medium',
				{ mcpLog: silentLog, projectRoot: dir, tag: 'master' },
				'json',
				{ title: 'New', description: 'New task' }
			);

			expect(result.newTaskId).toBe(4);
			expect(readTasks().map((t) => t.id)).toEqual(['1', '4']);
		});

		test('keeps a restored ID reserved: highestId never goes down', async () => {
			// Task 3 was archived, then everything after it restored or removed
			setup([task(1)], []);
			fs.writeFileSync(
				archivePath,
				JSON.stringify({ master: { tasks: [], metadata: { highestId: 3 } } })
			);

			const result = await addTask(
				tasksPath,
				null,
				[],
				'medium',
				{ mcpLog: silentLog, projectRoot: dir, tag: 'master' },
				'json',
				{ title: 'New', description: 'New task' }
			);

			expect(result.newTaskId).toBe(4);
		});
	});

	describe('parse-prd', () => {
		test('--append continues above the archived IDs', () => {
			setup([task(1), task(2)], [task(5)]);

			expect(loadExistingTasks(tasksPath, 'master').nextId).toBe(6);
		});

		test('an overwrite starts above the archived IDs, not at 1', () => {
			setup([task(1), task(2)], [task(5)]);

			expect(loadExistingTasks(tasksPath, 'master').firstFreeId).toBe(6);
		});

		test('with nothing archived, an overwrite still starts at 1', () => {
			setup([task(1), task(2)], []);

			expect(loadExistingTasks(tasksPath, 'master')).toMatchObject({
				nextId: 3,
				firstFreeId: 1
			});
		});
	});

	describe('move', () => {
		test('refuses to move a task onto an archived ID in the same tag', async () => {
			setup([task(1)], [task(2)]);

			await expect(
				moveTask(tasksPath, '1', '2', false, {
					projectRoot: dir,
					tag: 'master'
				})
			).rejects.toThrow(/Task 2 is archived/);
			expect(readTasks().map((t) => t.id)).toEqual([1]);
		});

		test('refuses to move a task into a tag where its ID is archived', async () => {
			setup([task(2)], [], { feature: [task(7)] });
			fs.writeFileSync(
				archivePath,
				JSON.stringify({
					feature: {
						tasks: [{ ...task(2), status: 'done', archivedAt: 'x' }],
						metadata: { highestId: 2 }
					}
				})
			);

			await expect(
				moveTasksBetweenTags(
					tasksPath,
					['2'],
					'master',
					'feature',
					{},
					{
						projectRoot: dir
					}
				)
			).rejects.toThrow(/Task 2 is archived in tag "feature"/);
			expect(readTasks('feature').map((t) => t.id)).toEqual([7]);
		});
	});

	describe('remove-subtask --convert', () => {
		test('gives the new task an ID above the archived ones', async () => {
			setup(
				[
					task(1, {
						subtasks: [
							{
								id: 1,
								title: 'Sub',
								description: 'Sub',
								status: 'pending',
								dependencies: []
							}
						]
					})
				],
				[task(4)]
			);

			const converted = await removeSubtask(tasksPath, '1.1', true, false, {
				projectRoot: dir,
				tag: 'master'
			});

			expect(converted.id).toBe(5);
		});
	});

	describe('dependencies on archived tasks', () => {
		test('validate-dependencies does not report them as missing', async () => {
			setup(
				[task(3, { dependencies: [1] })],
				[task(1, { subtasks: [{ id: 1, title: 's', status: 'done' }] })]
			);

			const result = await validateDependenciesCommand(tasksPath, {
				context: { projectRoot: dir, tag: 'master' }
			});

			expect(result.valid).toBe(true);
			expect(result.issues).toEqual([]);
		});

		test('fix-dependencies keeps them and still removes missing ones', async () => {
			setup(
				[
					task(3, {
						dependencies: [1, 9],
						subtasks: [
							{
								id: 1,
								title: 'Sub',
								description: 'Sub',
								status: 'pending',
								dependencies: ['1.1', '9.1']
							}
						]
					})
				],
				[task(1, { subtasks: [{ id: 1, title: 's', status: 'done' }] })]
			);

			const result = await fixDependenciesCommand(tasksPath, {
				context: { projectRoot: dir, tag: 'master' }
			});

			const [saved] = readTasks();
			expect(saved.dependencies).toEqual(['1']);
			expect(saved.subtasks[0].dependencies).toEqual(['1.1']);
			expect(result.fixes.map((f) => String(f.dependencyId))).toEqual(
				expect.arrayContaining(['9', '9.1'])
			);
			expect(
				result.fixes.some((f) => ['1', '1.1'].includes(String(f.dependencyId)))
			).toBe(false);
		});

		test('fix-dependencies and remove-task keep links to archived tasks', async () => {
			const links = { taskLinks: { 1: 'discovered-from', 9: 'related' } };
			setup([task(3, { metadata: links }), task(4)], [task(1)]);

			await fixDependenciesCommand(tasksPath, {
				context: { projectRoot: dir, tag: 'master' }
			});
			expect(readTasks()[0].metadata.taskLinks).toEqual({
				1: 'discovered-from'
			});

			await removeTask(tasksPath, '4', { projectRoot: dir, tag: 'master' });
			expect(readTasks()[0].metadata.taskLinks).toEqual({
				1: 'discovered-from'
			});
		});

		test('MCP next_task picks a task whose dependency is archived', async () => {
			setup([task(3, { dependencies: [1] })], [task(1)]);

			const result = await nextTaskDirect(
				{ tasksJsonPath: tasksPath, projectRoot: dir, tag: 'master' },
				silentLog
			);

			expect(result.success).toBe(true);
			expect(result.data.nextTask?.id).toBe(3);
		});
	});
});
