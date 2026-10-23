import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSubtask, createTask } from '../../../testing/task-fixtures.js';
import {
	addToArchive,
	archivePathFor,
	archiveTag,
	archivedTaskIds,
	copyArchiveTag,
	deleteArchivedTag,
	dropArchiveTag,
	isArchivedReference,
	lastChangedAt,
	nextTaskId,
	readArchivedIdsSync,
	renameArchiveTag,
	renameArchivedTag,
	satisfyArchivedDependencies,
	selectArchivable,
	takeFromArchive
} from './archive.js';
import { selectNextTask } from './next-task.js';
import { filterReadyTasks } from './task-filters.js';

const NOW = new Date('2026-10-23T12:00:00Z');
const daysAgo = (days: number) =>
	new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe('selectArchivable', () => {
	it('archives done and cancelled tasks last changed at least N days ago', () => {
		const tasks = [
			createTask({ id: 1, title: 'Old done', status: 'done', updatedAt: daysAgo(40) }),
			createTask({ id: 2, title: 'Old cancelled', status: 'cancelled', updatedAt: daysAgo(31) }),
			createTask({ id: 3, title: 'Recent done', status: 'done', updatedAt: daysAgo(2) }),
			createTask({ id: 4, title: 'Old pending', status: 'pending', updatedAt: daysAgo(90) }),
			createTask({ id: 5, title: 'Old review', status: 'review', updatedAt: daysAgo(90) })
		];

		const { archive, keep } = selectArchivable(tasks, { olderThanDays: 30, now: NOW });

		expect(archive.map((t) => t.id)).toEqual(['1', '2']);
		expect(keep.map((t) => t.id)).toEqual(['3', '4', '5']);
	});

	it('counts a finished task with no timestamp as old enough', () => {
		const task = createTask({ id: 1, title: 'Done long ago', status: 'done' });
		delete task.updatedAt;

		const { archive } = selectArchivable([task], { olderThanDays: 30, now: NOW });

		expect(archive).toHaveLength(1);
	});

	it('uses the latest subtask change when it is later than the task', () => {
		const task = createTask({
			id: 1,
			title: 'Parent',
			status: 'done',
			updatedAt: daysAgo(60),
			subtasks: [
				createSubtask({ id: 1, parentId: '1', title: 'Late', status: 'done', updatedAt: daysAgo(3) })
			]
		});

		expect(lastChangedAt(task)).toBe(Date.parse(daysAgo(3)));
		expect(selectArchivable([task], { olderThanDays: 30, now: NOW }).archive).toEqual([]);
	});

	it('archives every finished task with --older-than 0', () => {
		const task = createTask({ id: 1, title: 'Just done', status: 'done', updatedAt: NOW.toISOString() });

		expect(selectArchivable([task], { olderThanDays: 0, now: NOW }).archive).toHaveLength(1);
	});
});

describe('archive round trip', () => {
	it('adds tasks with archivedAt and takes one back without it', () => {
		const archived = addToArchive(
			{},
			'master',
			[createTask({ id: 3, title: 'Three', status: 'done' }), createTask({ id: 7, title: 'Seven', status: 'done' })],
			NOW
		);

		expect(archived.master.tasks.map((t) => t.id)).toEqual(['3', '7']);
		expect(archived.master.tasks[0].archivedAt).toBe(NOW.toISOString());
		expect(archived.master.metadata.highestId).toBe(7);

		const taken = takeFromArchive(archived, 'master', '7');

		expect(taken?.task.id).toBe('7');
		expect(taken?.task).not.toHaveProperty('archivedAt');
		expect(archivedTaskIds(taken?.archive, 'master')).toEqual(new Set(['3']));
	});

	it('keeps the highest archived ID reserved after a restore', () => {
		const archived = addToArchive({}, 'master', [createTask({ id: 9, title: 'Nine', status: 'done' })]);
		const taken = takeFromArchive(archived, 'master', '9');

		expect(taken?.archive.master.metadata.highestId).toBe(9);
	});

	it('keeps tags apart', () => {
		const archived = addToArchive(
			addToArchive({}, 'master', [createTask({ id: 1, title: 'M', status: 'done' })]),
			'feature',
			[createTask({ id: 1, title: 'F', status: 'done' })]
		);

		expect(archived.master.tasks[0].title).toBe('M');
		expect(archived.feature.tasks[0].title).toBe('F');
		expect(takeFromArchive(archived, 'feature', '1')?.archive.master.tasks).toHaveLength(1);
	});

	it('returns null for a task that is not archived', () => {
		expect(takeFromArchive({}, 'master', '4')).toBeNull();
	});

	it('replaces a copy left by an interrupted run instead of duplicating it', () => {
		const once = addToArchive({}, 'master', [createTask({ id: 2, title: 'Old copy', status: 'done' })]);
		const twice = addToArchive(once, 'master', [createTask({ id: 2, title: 'New copy', status: 'done' })]);

		expect(twice.master.tasks.map((t) => t.title)).toEqual(['New copy']);
	});
});

describe('nextTaskId', () => {
	it('goes above both live and archived IDs', () => {
		expect(nextTaskId([1, 2, 3], 10)).toBe(11);
		expect(nextTaskId(['4', '12'], 10)).toBe(13);
		expect(nextTaskId([], 0)).toBe(1);
	});
});

describe('archived dependencies', () => {
	const archivedIds = new Set(['3']);

	it('names an archived task or one of its subtasks', () => {
		expect(isArchivedReference('3', archivedIds)).toBe(true);
		expect(isArchivedReference('3.2', archivedIds)).toBe(true);
		expect(isArchivedReference('30', archivedIds)).toBe(false);
	});

	it('makes a pending task that depends on an archived one ready', () => {
		const tasks = [createTask({ id: 5, title: 'Waiting', dependencies: ['3'] })];

		expect(selectNextTask(tasks)).toBeNull();
		expect(selectNextTask(satisfyArchivedDependencies(tasks, archivedIds))?.id).toBe('5');
	});

	it('keeps sibling subtask dependencies and drops ones on archived tasks', () => {
		const [task] = satisfyArchivedDependencies(
			[
				createTask({
					id: 5,
					title: 'Parent',
					subtasks: [
						createSubtask({ id: 1, parentId: '5', title: 'A' }),
						createSubtask({ id: 2, parentId: '5', title: 'B', dependencies: [1, '3.1', '3'] })
					]
				})
			],
			archivedIds
		);

		expect(task.subtasks[1].dependencies).toEqual([1]);
	});

	it('treats a task that is back in tasks.json as live, not archived', () => {
		const tasks = [
			createTask({ id: 3, title: 'Restored', status: 'pending' }),
			createTask({ id: 5, title: 'Waiting', dependencies: ['3'] })
		];

		expect(satisfyArchivedDependencies(tasks, archivedIds)[1].dependencies).toEqual(['3']);
	});
});

describe('readArchivedIdsSync', () => {
	let dir: string | undefined;

	afterEach(() => {
		if (dir) fs.rmSync(dir, { recursive: true, force: true });
		dir = undefined;
	});

	it('reads the tag section of archive.json next to tasks.json', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archive-'));
		const tasksPath = path.join(dir, 'tasks.json');
		fs.writeFileSync(
			archivePathFor(tasksPath),
			JSON.stringify(addToArchive({}, 'feature', [createTask({ id: 8, title: 'E', status: 'done' })]))
		);

		expect(readArchivedIdsSync(tasksPath, 'feature')).toEqual({ ids: new Set(['8']), highestId: 8 });
		expect(readArchivedIdsSync(tasksPath, 'master')).toEqual({ ids: new Set(), highestId: 0 });
	});

	it('has nothing reserved when there is no archive', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archive-'));

		expect(readArchivedIdsSync(path.join(dir, 'tasks.json'), 'master').highestId).toBe(0);
	});

	it('refuses an archive that is not valid JSON, so reserved IDs are not lost', () => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archive-'));
		const tasksPath = path.join(dir, 'tasks.json');
		fs.writeFileSync(archivePathFor(tasksPath), '{ nope');

		expect(() => readArchivedIdsSync(tasksPath, 'master')).toThrow(/isn't valid JSON/);
	});
});

describe('tag rename and delete', () => {
	const archive = () => ({
		...addToArchive({}, 'feature', [createTask({ id: 4, title: 'F', status: 'done' })], NOW),
		...addToArchive({}, 'master', [createTask({ id: 2, title: 'M', status: 'done' })], NOW)
	});

	it('moves a renamed tag\'s section and leaves the others', () => {
		const renamed = renameArchiveTag(archive(), 'feature', 'launch');

		expect(Object.keys(renamed ?? {}).sort()).toEqual(['launch', 'master']);
		expect(renamed?.launch.metadata.highestId).toBe(4);
	});

	it('drops a deleted tag\'s section', () => {
		expect(Object.keys(dropArchiveTag(archive(), 'feature') ?? {})).toEqual(['master']);
	});

	it('returns null when the tag has nothing archived', () => {
		expect(renameArchiveTag(archive(), 'other', 'x')).toBeNull();
		expect(dropArchiveTag(archive(), 'other')).toBeNull();
	});

	it('copies a tag\'s section for a tag copy and leaves the source', () => {
		const copied = copyArchiveTag(archive(), 'feature', 'copy');

		expect(Object.keys(copied ?? {}).sort()).toEqual(['copy', 'feature', 'master']);
		expect(copied?.copy).toEqual(copied?.feature);
		expect(copied?.copy).not.toBe(copied?.feature);
		expect(copyArchiveTag(archive(), 'other', 'copy')).toBeNull();
	});

	it('never reads a tag named like an Object.prototype key through the prototype', () => {
		for (const tag of ['constructor', 'toString', '__proto__']) {
			expect(archiveTag(archive(), tag).tasks).toEqual([]);
			expect(renameArchiveTag(archive(), tag, 'x')).toBeNull();
			expect(dropArchiveTag(archive(), tag)).toBeNull();
			expect(copyArchiveTag(archive(), tag, 'x')).toBeNull();
		}
	});

	it('keeps a tag named __proto__ as data through a JSON round trip', () => {
		const stored = JSON.parse(
			JSON.stringify(
				addToArchive({}, '__proto__', [createTask({ id: 7, title: 'P', status: 'done' })], NOW)
			)
		);

		expect(archiveTag(stored, '__proto__').metadata.highestId).toBe(7);
		expect(Object.getPrototypeOf(stored)).toBe(Object.prototype);
		expect(({} as Record<string, unknown>).tasks).toBeUndefined();
	});

	it('updates archive.json on disk under its lock, and creates none when there is no archive', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tg-archive-tag-'));
		try {
			const tasksPath = path.join(dir, 'tasks.json');
			await renameArchivedTag(tasksPath, 'feature', 'launch');
			expect(fs.existsSync(archivePathFor(tasksPath))).toBe(false);

			fs.writeFileSync(archivePathFor(tasksPath), JSON.stringify(archive()));
			await renameArchivedTag(tasksPath, 'feature', 'launch');
			expect(readArchivedIdsSync(tasksPath, 'launch').ids).toEqual(new Set(['4']));
			expect(readArchivedIdsSync(tasksPath, 'feature').highestId).toBe(0);

			await deleteArchivedTag(tasksPath, 'launch');
			expect(readArchivedIdsSync(tasksPath, 'launch').highestId).toBe(0);
			expect(readArchivedIdsSync(tasksPath, 'master').ids).toEqual(new Set(['2']));
			expect(fs.readdirSync(dir).sort()).toEqual(['archive.json']);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('filterReadyTasks with archived IDs', () => {
	const withBlocks = (task: ReturnType<typeof createTask>) => ({ ...task, blocks: [] });

	it('counts a dependency on an archived task or its subtask as done', () => {
		const tasks = [
			withBlocks(createTask({ id: 3, title: 'T', dependencies: ['1', '1.2'] }))
		];

		expect(filterReadyTasks(tasks, new Set(['1'])).map((t) => String(t.id))).toEqual(['3']);
	});

	it('goes by the live task when the same ID is also archived (left by an interrupted run)', () => {
		const tasks = [
			withBlocks(createTask({ id: 1, title: 'Live', status: 'pending' })),
			withBlocks(createTask({ id: 3, title: 'T', dependencies: ['1.2'] }))
		];

		expect(filterReadyTasks(tasks, new Set(['1'])).map((t) => String(t.id))).toEqual(['1']);
	});
});
