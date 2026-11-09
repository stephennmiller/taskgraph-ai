/**
 * @fileoverview Tag create/delete/rename/stats operations on the single tasks.json file
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { isTaskComplete } from '../../../../common/constants/index.js';
import {
	ERROR_CODES,
	TaskGraphError,
	errorWithHint
} from '../../../../common/errors/taskgraph-error.js';
import type { IStorage } from '../../../../common/interfaces/storage.interface.js';
import {
	type ArchiveData,
	archiveTag,
	copyArchiveTag,
	dropArchiveTag,
	hasGithubLink,
	highestTaskId,
	readArchiveSync,
	removedTagMark,
	renameArchiveTag
} from '../../../tasks/utils/archive.js';
import { CLAIM_KEYS, withoutClaim } from '../../../tasks/utils/claim.js';
import { complexityReportPath } from '../../../reports/managers/complexity-report-manager.js';
import type { FileOperations } from './file-operations.js';
import type { FormatHandler } from './format-handler.js';
import { getOwnKey, setOwnKey } from '../../../../common/utils/own-key.js';
import type { PathResolver } from './path-resolver.js';
import { storedTagOrDefault } from '../../../tasks/utils/tag-names.js';
import { filterReadyTasks } from '../../../tasks/utils/task-filters.js';
import { stampTasksFileSchemaVersion } from './schema-version.js';

/**
 * A deep copy of a tag's tasks for another tag, without each task's and
 * subtask's GitHub link and claim: those belong to the original, and a push
 * from the copy would otherwise take over the original's issues
 */
function copyTasks(source: unknown): any[] {
	const tasks = Array.isArray(source) ? JSON.parse(JSON.stringify(source)) : [];
	for (const item of [
		...tasks,
		...tasks.flatMap((t: any) => t?.subtasks ?? [])
	]) {
		if (!item || typeof item !== 'object') continue;
		const metadata = withoutClaim(item.metadata, ['github', ...CLAIM_KEYS]);
		if (metadata) item.metadata = metadata;
		else delete item.metadata;
	}
	return tasks;
}

/**
 * Whether a tag of tasks.json is known never to have had a GitHub issue
 * link on a task (see githubLinkedAfter in tag-update.ts)
 */
function neverLinked(section: any): boolean {
	return (
		section?.metadata?.githubLinked === false && !hasGithubLink(section.tasks)
	);
}

function tagNotFound(tag: string): TaskGraphError {
	return new TaskGraphError(
		`Tag "${tag}" does not exist`,
		ERROR_CODES.NOT_FOUND
	);
}

/**
 * Tag-level operations extracted from FileStorage. Reads go back through the
 * storage instance so load behavior (complexity enrichment, schema checks) is shared.
 */
export class TagOperations {
	constructor(
		private readonly pathResolver: PathResolver,
		private readonly fileOps: FileOperations,
		private readonly formatHandler: FormatHandler,
		private readonly reader: Pick<
			IStorage,
			'loadTasks' | 'loadMetadata' | 'getAllTags' | 'loadArchivedTaskIds'
		>
	) {}

	/**
	 * Create a new tag in the tasks.json file, empty or with a copy of
	 * another tag's tasks. A missing file is created with an empty master.
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 * @returns How many tasks were copied (0 when the source has none or is missing)
	 */
	async createTag(
		tagName: string,
		options?: { copyFrom?: string; description?: string }
	): Promise<number> {
		const filePath = this.pathResolver.getTasksPath();
		let tasksCopied = 0;

		await this.modifyTagged(filePath, (data) => {
			if (Object.hasOwn(data, tagName)) {
				throw new TaskGraphError(
					`Tag "${tagName}" already exists`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			const tasks = copyTasks(
				options?.copyFrom ? getOwnKey(data, options.copyFrom)?.tasks : undefined
			);
			this.assertNoRetiredIds(tagName, tasks);
			tasksCopied = tasks.length;
			const now = new Date().toISOString();
			setOwnKey(data, tagName, {
				tasks,
				metadata: {
					created: now,
					updated: now,
					description: options?.description,
					...this.inheritedMetadata(tagName)
				}
			});
			return data;
		});
		// A copy keeps the source's archived tasks: its dependencies on them
		// still count as done, and their IDs stay reserved in the copy
		if (options?.copyFrom !== undefined) {
			await this.copyArchivedTasks(options.copyFrom, tagName);
		}
		return tasksCopied;
	}

	/**
	 * Copy a tag with all its tasks (deep copied) and its archived tasks
	 * @returns How many tasks were copied
	 */
	async copyTag(
		sourceTag: string,
		targetTag: string,
		options?: { description?: string }
	): Promise<number> {
		const filePath = this.pathResolver.getTasksPath();
		let tasksCopied = 0;

		await this.modifyTagged(filePath, (data) => {
			const source = getOwnKey(data, sourceTag);
			if (!source) {
				throw new TaskGraphError(
					`Source tag "${sourceTag}" does not exist`,
					ERROR_CODES.NOT_FOUND
				);
			}
			if (Object.hasOwn(data, targetTag)) {
				throw new TaskGraphError(
					`Target tag "${targetTag}" already exists`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			const tasks = copyTasks(source.tasks);
			this.assertNoRetiredIds(targetTag, tasks);
			tasksCopied = tasks.length;
			const now = new Date().toISOString();
			setOwnKey(data, targetTag, {
				tasks,
				metadata: {
					created: now,
					updated: now,
					description: options?.description,
					copiedFrom: { tag: sourceTag, date: now },
					...this.inheritedMetadata(targetTag)
				}
			});
			return data;
		});
		await this.copyArchivedTasks(sourceTag, targetTag);
		return tasksCopied;
	}

	/**
	 * Read-modify-write tasks.json in the tagged form: an old single-list
	 * file becomes its master tag, and a missing one starts with an empty
	 * master. Every tag is stamped as the other writers stamp it.
	 */
	private async modifyTagged(
		filePath: string,
		change: (data: Record<string, any>) => Record<string, any>
	): Promise<void> {
		await this.fileOps.modifyJson(filePath, (existingData: any) => {
			let data = existingData ?? {};
			if (this.formatHandler.detectFormat(data) !== 'legacy') {
				data = {
					master: {
						tasks: data.tasks || [],
						metadata: data.metadata || {
							created: new Date().toISOString(),
							description: 'Tasks for master context'
						}
					}
				};
			}
			return stampTasksFileSchemaVersion(change(data));
		});
	}

	/**
	 * Delete a tag, its archived tasks and its complexity report. The archive
	 * keeps the tag's highest ID, so a tag recreated with the name never
	 * reuses one (see dropArchiveTag)
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async deleteTag(tag: string): Promise<void> {
		let highestId = 0;
		let unlinked = false;
		await this.modifyTagged(this.pathResolver.getTasksPath(), (data) => {
			if (!Object.hasOwn(data, tag)) throw tagNotFound(tag);
			highestId = highestTaskId(getOwnKey(data, tag));
			unlinked = neverLinked(getOwnKey(data, tag));
			delete data[tag];
			return data;
		});
		await this.updateArchive((archive) =>
			dropArchiveTag(archive, tag, highestId, unlinked)
		);
		const report = this.reportPath(tag);
		if (report) await fs.rm(report, { force: true });
	}

	/**
	 * Rename a tag, noting the old name in its metadata, and move its
	 * archived tasks and complexity report with it. The old name keeps the
	 * tag's highest ID, as on a delete
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async renameTag(oldTag: string, newTag: string): Promise<void> {
		let highestId = 0;
		let unlinked = false;
		await this.modifyTagged(this.pathResolver.getTasksPath(), (data) => {
			if (!Object.hasOwn(data, oldTag)) throw tagNotFound(oldTag);
			// Checked under the lock: a tag created since the caller's check would be overwritten
			if (Object.hasOwn(data, newTag)) {
				throw new TaskGraphError(
					`Tag "${newTag}" already exists`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			highestId = highestTaskId(getOwnKey(data, oldTag));
			this.assertNoRetiredIds(newTag, getOwnKey(data, oldTag).tasks, oldTag);
			unlinked = neverLinked(getOwnKey(data, oldTag));
			const tagData = { ...getOwnKey(data, oldTag) };
			if (tagData.metadata) {
				tagData.metadata = {
					...tagData.metadata,
					renamed: { from: oldTag, date: new Date().toISOString() }
				};
			}
			// Issues may still point at the new name's old IDs, so removing
			// this tag later must not free that name
			if (!this.removedTagMark(newTag).free) {
				tagData.metadata = { ...tagData.metadata, githubLinked: true };
			}
			setOwnKey(data, newTag, tagData);
			delete data[oldTag];
			return data;
		});
		await this.updateArchive((archive) =>
			renameArchiveTag(archive, oldTag, newTag, highestId, unlinked)
		);
		const from = this.reportPath(oldTag);
		const to = this.reportPath(newTag);
		if (from && to) {
			await fs.rename(from, to).catch((error) => {
				if (error?.code !== 'ENOENT') throw error;
			});
		}
	}

	/** What a removed or renamed tag left under this name in archive.json */
	removedTagMark = (tag: string) =>
		removedTagMark(readArchiveSync(this.pathResolver.getArchivePath()), tag);

	/**
	 * What a tag created by `tags add` or `tags copy` starts with from a
	 * removed tag of its name. Its IDs stay taken: move --to-tag numbers
	 * above `highestId`, as add-task does from the archive (#1095). When the
	 * name is free, the new tag starts with no GitHub link on record.
	 */
	private inheritedMetadata(tag: string): {
		highestId?: number;
		githubLinked?: false;
	} {
		const { highestId, free } = this.removedTagMark(tag);
		return {
			...(highestId > 0 && { highestId }),
			...(free && { githubLinked: false as const })
		};
	}

	/**
	 * Refuse to put tasks under the name of a removed or renamed tag when one
	 * of their IDs is one that tag used: GitHub link recovery finds an issue
	 * by tag and ID, so the task would take over the old task's issue. A tag
	 * renamed back to its old name (the tombstone's `renamedTo`) is its own,
	 * and a name whose tombstone records that the tag never had a GitHub
	 * link is free (#1126).
	 */
	assertNoRetiredIds(tag: string, tasks: unknown, renamedFrom?: string): void {
		const archive = readArchiveSync(this.pathResolver.getArchivePath());
		const { metadata } = archiveTag(archive, tag);
		if (renamedFrom !== undefined && metadata.renamedTo === renamedFrom) {
			return;
		}
		if (removedTagMark(archive, tag).free) return;
		const ids = Array.isArray(tasks) ? tasks.map((t) => Number(t?.id)) : [];
		if (!ids.some((id) => id <= metadata.highestId)) return;
		throw errorWithHint(
			ERROR_CODES.VALIDATION_ERROR,
			`Tag "${tag}" was removed or renamed, and its tasks used IDs up to ${metadata.highestId}. Tasks put under that name would reuse them and take over their GitHub issues; use another name`,
			`Or give them new IDs under that name: \`taskgraph tags add ${tag}\`, then \`taskgraph move --from <ids> --from-tag <tag> --to-tag ${tag}\` numbers them above ${metadata.highestId}. That moves the tasks; copy the tag to a spare name first to keep the originals`
		);
	}

	/** A tag's complexity report; undefined for a name that can't name a file */
	private reportPath(tag: string): string | undefined {
		try {
			return complexityReportPath(
				path.dirname(this.pathResolver.getBasePath()),
				tag
			);
		} catch {
			return undefined;
		}
	}

	/**
	 * Give a copy of a tag the source's archived tasks: the copy's
	 * dependencies on them still count as done, and their IDs stay reserved
	 */
	private async copyArchivedTasks(
		fromTag: string,
		toTag: string
	): Promise<void> {
		await this.updateArchive((archive) =>
			copyArchiveTag(archive, fromTag, toTag)
		);
	}

	/**
	 * Apply a tag change to archive.json under its lock. Leaves the file alone
	 * when the change has nothing to record, and creates it only when there is.
	 */
	private async updateArchive(
		change: (archive: ArchiveData) => ArchiveData | null
	): Promise<void> {
		const archivePath = this.pathResolver.getArchivePath();
		if (!(await this.fileOps.exists(archivePath)) && change({}) === null) {
			return;
		}
		await this.fileOps.modifyJson(
			archivePath,
			(current: ArchiveData) => change(current ?? {}) ?? current
		);
	}

	/**
	 * Get all tags with detailed statistics including task counts
	 * For file storage, reads tags from tasks.json and calculates statistics
	 */
	async getTagsWithStats(): Promise<{
		tags: Array<{
			name: string;
			isCurrent: boolean;
			taskCount: number;
			completedTasks: number;
			readyTasks: number;
			statusBreakdown: Record<string, number>;
			subtaskCounts?: {
				totalSubtasks: number;
				subtasksByStatus: Record<string, number>;
			};
			created?: string;
			description?: string;
		}>;
		currentTag: string | null;
		totalTags: number;
	}> {
		const availableTags = await this.reader.getAllTags();

		// Get active tag from state.json
		const activeTag = await this.getActiveTagFromState();

		const tagsWithStats = await Promise.all(
			availableTags.map(async (tagName) => {
				// Outside the catch below: an unreadable archive.json is an error,
				// not a tag with no tasks
				const archivedIds = await this.reader.loadArchivedTaskIds(tagName);
				try {
					// Load tasks for this tag
					const tasks = await this.reader.loadTasks(tagName);

					// Calculate statistics
					const statusBreakdown: Record<string, number> = {};
					let completedTasks = 0;

					const subtaskCounts = {
						totalSubtasks: 0,
						subtasksByStatus: {} as Record<string, number>
					};

					tasks.forEach((task) => {
						// Count task status
						const status = task.status || 'pending';
						statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;

						if (isTaskComplete(status)) {
							completedTasks++;
						}

						// Count subtasks
						if (task.subtasks && task.subtasks.length > 0) {
							subtaskCounts.totalSubtasks += task.subtasks.length;

							task.subtasks.forEach((subtask) => {
								const subStatus = subtask.status || 'pending';
								subtaskCounts.subtasksByStatus[subStatus] =
									(subtaskCounts.subtasksByStatus[subStatus] || 0) + 1;
							});
						}
					});

					// Ready: actionable, with every dependency complete; archived
					// tasks count as done
					const readyTasks = filterReadyTasks(
						tasks.map((task) => ({ ...task, blocks: [] })),
						archivedIds
					).length;

					// Load metadata to get created date and description
					const metadata = await this.reader.loadMetadata(tagName);

					return {
						name: tagName,
						isCurrent: tagName === activeTag,
						taskCount: tasks.length,
						completedTasks,
						readyTasks,
						statusBreakdown,
						subtaskCounts:
							subtaskCounts.totalSubtasks > 0 ? subtaskCounts : undefined,
						created: metadata?.created,
						description: metadata?.description
					};
				} catch (error) {
					// If we can't load tasks for a tag, return it with 0 tasks
					return {
						name: tagName,
						isCurrent: tagName === activeTag,
						taskCount: 0,
						completedTasks: 0,
						readyTasks: 0,
						statusBreakdown: {}
					};
				}
			})
		);

		return {
			tags: tagsWithStats,
			currentTag: activeTag,
			totalTags: tagsWithStats.length
		};
	}

	/**
	 * Get the active tag from state.json
	 * @returns The active tag name or 'master' as default
	 */
	private async getActiveTagFromState(): Promise<string> {
		try {
			const statePath = path.join(
				this.pathResolver.getBasePath(),
				'state.json'
			);
			const stateData = await this.fileOps.readJson(statePath);
			return storedTagOrDefault(stateData?.currentTag);
		} catch (error) {
			// If state.json doesn't exist or can't be read, default to 'master'
			return 'master';
		}
	}
}
