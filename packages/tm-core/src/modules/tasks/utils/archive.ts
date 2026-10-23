/**
 * @fileoverview Archive: finished tasks move out of tasks.json into
 * `.taskgraph/tasks/archive.json`, one section per tag, shaped like tasks.json:
 *
 *   { "master": { "tasks": [{ ...task, "archivedAt": "…" }],
 *                 "metadata": { "highestId": 42, "lastModified": "…" } } }
 *
 * Rules every command follows:
 * - A task is archived when it is done or cancelled and its last change
 *   (`updatedAt`, or a subtask's when later) is at least N days old. A
 *   finished task with no timestamp was finished before TaskGraph recorded
 *   one, so it counts as old enough.
 * - Archived IDs stay reserved: `highestId` only grows, even after a restore,
 *   and new task IDs start above it.
 * - A dependency on an archived task (or one of its subtasks) counts as done.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Task } from '../../../common/types/index.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import { FileOperations } from '../../storage/adapters/file-storage/file-operations.js';

/** Days a finished task stays in tasks.json before `archive` moves it */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 30;

/** The archive's file name, next to tasks.json */
export const ARCHIVE_FILE_NAME = 'archive.json';

const DAY_MS = 24 * 60 * 60 * 1000;

/** A task as the archive stores it */
export type ArchivedTask = Task & { archivedAt: string };

/** One tag's section of archive.json */
export interface ArchiveTagData {
	tasks: ArchivedTask[];
	metadata: {
		/** Highest task ID ever archived in this tag; never goes down */
		highestId: number;
		lastModified?: string;
	};
}

/** The parsed archive.json */
export type ArchiveData = Record<string, ArchiveTagData>;

/** The archive file that goes with a tasks file */
export function archivePathFor(tasksPath: string): string {
	return path.join(path.dirname(tasksPath), ARCHIVE_FILE_NAME);
}

/** Whether a status means the work is over */
export function isFinishedStatus(status: string | undefined): boolean {
	return status === 'done' || status === 'completed' || status === 'cancelled';
}

/**
 * When a task last changed: the latest `updatedAt` of the task and its
 * subtasks, in ms. Null when none is recorded.
 */
export function lastChangedAt(task: Task): number | null {
	const times = [task.updatedAt, ...(task.subtasks ?? []).map((s) => s.updatedAt)]
		.map((value) => (value ? Date.parse(value) : Number.NaN))
		.filter((ms) => !Number.isNaN(ms));
	return times.length > 0 ? Math.max(...times) : null;
}

export interface SelectArchivableOptions {
	/** Archive tasks finished at least this many days ago */
	olderThanDays: number;
	/** Defaults to the current time */
	now?: Date;
}

/**
 * Split a tag's tasks into those to archive and those to keep. A finished
 * task without a timestamp is archived (see the file comment).
 */
export function selectArchivable(
	tasks: Task[],
	options: SelectArchivableOptions
): { archive: Task[]; keep: Task[] } {
	const now = (options.now ?? new Date()).getTime();
	const cutoff = now - Math.max(0, options.olderThanDays) * DAY_MS;
	const archive: Task[] = [];
	const keep: Task[] = [];
	for (const task of tasks) {
		const changed = lastChangedAt(task);
		if (isFinishedStatus(task.status) && (changed === null || changed <= cutoff)) {
			archive.push(task);
		} else {
			keep.push(task);
		}
	}
	return { archive, keep };
}

const numericId = (id: unknown): number => {
	const n = Number.parseInt(String(id), 10);
	return Number.isNaN(n) ? 0 : n;
};

const byId = (a: { id: unknown }, b: { id: unknown }) =>
	numericId(a.id) - numericId(b.id);

/**
 * A tag's own section of the archive. A tag may be named `constructor` or
 * `__proto__`, so this never reads through the object's prototype.
 */
function ownSection(archive: unknown, tag: string): unknown {
	return archive && typeof archive === 'object' && Object.hasOwn(archive, tag)
		? (archive as Record<string, unknown>)[tag]
		: undefined;
}

/** A tag's section, or an empty one. Tolerates a hand-edited file. */
export function archiveTag(archive: unknown, tag: string): ArchiveTagData {
	const section = ownSection(archive, tag);
	const tasks = Array.isArray((section as ArchiveTagData | undefined)?.tasks)
		? (section as ArchiveTagData).tasks
		: [];
	const stored = Number((section as ArchiveTagData | undefined)?.metadata?.highestId);
	return {
		tasks,
		metadata: {
			...((section as ArchiveTagData | undefined)?.metadata ?? {}),
			highestId: Math.max(
				Number.isFinite(stored) ? stored : 0,
				0,
				...tasks.map((t) => numericId(t.id))
			)
		}
	};
}

/**
 * The archive with `tasks` added to `tag`. A copy of the same ID already
 * there (left by an interrupted run) is replaced.
 */
export function addToArchive(
	archive: ArchiveData,
	tag: string,
	tasks: Task[],
	now: Date = new Date()
): ArchiveData {
	const current = archiveTag(archive, tag);
	const stamp = now.toISOString();
	const incoming = new Set(tasks.map((t) => String(t.id)));
	const merged = [
		...current.tasks.filter((t) => !incoming.has(String(t.id))),
		...tasks.map((t) => ({ ...t, archivedAt: stamp }))
	].sort(byId);
	return {
		...archive,
		[tag]: {
			tasks: merged,
			metadata: {
				...current.metadata,
				highestId: Math.max(
					current.metadata.highestId,
					...merged.map((t) => numericId(t.id))
				),
				lastModified: stamp
			}
		}
	};
}

/**
 * Take one task out of a tag's archive. `highestId` is kept, so the ID stays
 * reserved while the task is back in tasks.json.
 * @returns null when the task isn't archived in that tag
 */
export function takeFromArchive(
	archive: ArchiveData,
	tag: string,
	taskId: string
): { archive: ArchiveData; task: Task } | null {
	const current = archiveTag(archive, tag);
	const index = current.tasks.findIndex((t) => String(t.id) === String(taskId));
	if (index === -1) return null;
	const { archivedAt: _archivedAt, ...task } = current.tasks[index];
	const tasks = current.tasks.filter((_, i) => i !== index);
	return {
		archive: {
			...archive,
			[tag]: {
				tasks,
				metadata: { ...current.metadata, lastModified: new Date().toISOString() }
			}
		},
		task: task as Task
	};
}

/** Put a restored task back in ID order */
export function insertById(tasks: Task[], task: Task): Task[] {
	const at = tasks.findIndex((t) => numericId(t.id) > numericId(task.id));
	return at === -1
		? [...tasks, task]
		: [...tasks.slice(0, at), task, ...tasks.slice(at)];
}

/** A tag's archived tasks by ID, as they were before archiving */
export function archivedTasksById(
	archive: unknown,
	tag: string
): { tasks: Map<string, Task>; highestId: number } {
	const section = archiveTag(archive, tag);
	return {
		tasks: new Map(
			section.tasks.map(({ archivedAt: _at, ...task }) => [
				String(task.id),
				task as Task
			])
		),
		highestId: section.metadata.highestId
	};
}

/** IDs of the tasks archived in a tag */
export function archivedTaskIds(archive: unknown, tag: string): Set<string> {
	return new Set(archiveTag(archive, tag).tasks.map((t) => String(t.id)));
}

/**
 * The next free task ID: one above every ID in use and every ID ever
 * archived in the tag
 * @param ids - IDs of the tag's tasks in tasks.json
 * @param reservedFloor - The archive's `highestId` for the tag
 */
export function nextTaskId(
	ids: Iterable<string | number>,
	reservedFloor = 0
): number {
	let highest = reservedFloor;
	for (const id of ids) highest = Math.max(highest, numericId(id));
	return highest + 1;
}

/**
 * Whether a full dependency ID (`"3"` or `"3.2"`) names an archived task or a
 * subtask of one. Resolve a subtask's sibling reference first
 * (resolveSubtaskDependency).
 */
export function isArchivedReference(
	dependency: string | number,
	archivedIds: ReadonlySet<string>
): boolean {
	if (archivedIds.size === 0) return false;
	return archivedIds.has(String(dependency).split('.')[0]);
}

/**
 * Tasks with every dependency on an archived task taken out, so readiness,
 * blocker and tree logic treat those dependencies as done. For reading only:
 * never save the result. A task that is back in tasks.json isn't archived.
 */
export function satisfyArchivedDependencies<T extends Task>(
	tasks: T[],
	archivedIds: ReadonlySet<string>
): T[] {
	if (archivedIds.size === 0) return tasks;
	const live = new Set(tasks.map((t) => String(t.id)));
	const archived = new Set([...archivedIds].filter((id) => !live.has(id)));
	if (archived.size === 0) return tasks;

	return tasks.map((task) => ({
		...task,
		dependencies: (task.dependencies ?? []).filter(
			(dep) => !isArchivedReference(dep, archived)
		),
		subtasks: (task.subtasks ?? []).map((subtask) => ({
			...subtask,
			dependencies: (subtask.dependencies ?? []).filter(
				(dep) =>
					!isArchivedReference(resolveSubtaskDependency(task.id, dep), archived)
			)
		}))
	}));
}

/**
 * A task or subtask picked from satisfyArchivedDependencies' view, with the
 * dependencies it really has put back, so `next` still shows a dependency on
 * an archived task (as done) instead of none
 * @param picked - What selectNextTask returned for the view
 * @param tasks - The tag's tasks as stored
 */
export function withStoredDependencies<T extends Task>(
	picked: T,
	tasks: Task[]
): T {
	const [taskId, subtaskId] = String(picked.id).split('.');
	const task = tasks.find((t) => String(t.id) === taskId);
	if (!task) return picked;
	if (subtaskId === undefined) {
		return { ...picked, dependencies: task.dependencies ?? [] };
	}
	const subtask = task.subtasks?.find((s) => String(s.id) === subtaskId);
	if (!subtask) return picked;
	return {
		...picked,
		dependencies: (subtask.dependencies ?? []).map((dep) =>
			resolveSubtaskDependency(task.id, dep)
		)
	};
}

/**
 * Read archive.json synchronously, for the legacy scripts
 * @returns {} when the file is missing or empty
 * @throws when it exists but isn't valid JSON, so a broken archive can't
 * silently free reserved IDs
 */
export function readArchiveSync(archivePath: string): ArchiveData {
	let content: string;
	try {
		content = fs.readFileSync(archivePath, 'utf8');
	} catch (error: any) {
		if (error?.code === 'ENOENT') return {};
		throw error;
	}
	if (content.trim() === '') return {};
	try {
		const parsed = JSON.parse(content);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch (error: any) {
		throw new Error(`${archivePath} isn't valid JSON: ${error.message}`);
	}
}

/** What the archive reserves in one tag */
export interface ArchivedIds {
	/** IDs of the tasks archived in the tag */
	ids: Set<string>;
	/** Highest ID ever archived in the tag; new IDs go above it */
	highestId: number;
}

/**
 * The archived IDs for a tag of the tasks file at `tasksPath`, read
 * synchronously. Read tasks.json before calling this: archive writes
 * archive.json first, so a task is always in at least one of them.
 */
export function readArchivedIdsSync(tasksPath: string, tag: string): ArchivedIds {
	const section = archiveTag(readArchiveSync(archivePathFor(tasksPath)), tag);
	return {
		ids: new Set(section.tasks.map((t) => String(t.id))),
		highestId: section.metadata.highestId
	};
}

/**
 * The archive with a tag's section moved to a new tag name, for a tag
 * rename. A section already under the new name (left by a tag deleted
 * before deletes cleaned up the archive) is replaced.
 * @returns null when the old tag has nothing archived
 */
export function renameArchiveTag(
	archive: ArchiveData,
	oldTag: string,
	newTag: string
): ArchiveData | null {
	const section = ownSection(archive, oldTag);
	if (section === undefined) return null;
	const { [oldTag]: _old, ...rest } = archive;
	return { ...rest, [newTag]: section as ArchiveTagData };
}

/**
 * The archive with a copy of a tag's section under a new tag name, for a tag
 * copy: the copied tasks keep their dependencies on archived tasks (which
 * still count as done), and the new tag never reuses an archived ID
 * @returns null when the source tag has nothing archived
 */
export function copyArchiveTag(
	archive: ArchiveData,
	fromTag: string,
	toTag: string
): ArchiveData | null {
	const section = ownSection(archive, fromTag);
	if (section === undefined) return null;
	return { ...archive, [toTag]: structuredClone(section) as ArchiveTagData };
}

/**
 * The archive without a tag's section, for a tag delete: its archived tasks
 * go with the tag
 * @returns null when the tag has nothing archived
 */
export function dropArchiveTag(
	archive: ArchiveData,
	tag: string
): ArchiveData | null {
	if (ownSection(archive, tag) === undefined) return null;
	const { [tag]: _dropped, ...rest } = archive;
	return rest;
}

/**
 * Apply a tag change to archive.json under its lock (the same lock tm-core's
 * archive and restore take), with an atomic write, so a concurrent archive
 * run's tasks are never lost. Does nothing when there is no archive or the
 * tag has nothing archived.
 */
async function updateArchiveFile(
	tasksPath: string,
	change: (archive: ArchiveData) => ArchiveData | null
): Promise<void> {
	const archivePath = archivePathFor(tasksPath);
	const fileOps = new FileOperations();
	try {
		if (!(await fileOps.exists(archivePath))) return;
		await fileOps.modifyJson(
			archivePath,
			(current: ArchiveData) => change(current ?? {}) ?? current
		);
	} finally {
		await fileOps.cleanup();
	}
}

/** Move a renamed tag's archived tasks to its new name (see renameArchiveTag) */
export function renameArchivedTag(
	tasksPath: string,
	oldTag: string,
	newTag: string
): Promise<void> {
	return updateArchiveFile(tasksPath, (archive) =>
		renameArchiveTag(archive, oldTag, newTag)
	);
}

/** Remove a deleted tag's archived tasks (see dropArchiveTag) */
export function deleteArchivedTag(tasksPath: string, tag: string): Promise<void> {
	return updateArchiveFile(tasksPath, (archive) => dropArchiveTag(archive, tag));
}

/** Copy a tag's archived tasks to a copy of the tag (see copyArchiveTag) */
export function copyArchivedTag(
	tasksPath: string,
	fromTag: string,
	toTag: string
): Promise<void> {
	return updateArchiveFile(tasksPath, (archive) =>
		copyArchiveTag(archive, fromTag, toTag)
	);
}
