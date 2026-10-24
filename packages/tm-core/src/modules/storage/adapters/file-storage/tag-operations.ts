/**
 * @fileoverview Tag create/delete/rename/stats operations on the single tasks.json file
 */

import path from 'node:path';
import { isTaskComplete } from '../../../../common/constants/index.js';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../../common/errors/taskgraph-error.js';
import type { IStorage } from '../../../../common/interfaces/storage.interface.js';
import {
	type ArchiveData,
	copyArchiveTag,
	dropArchiveTag,
	renameArchiveTag
} from '../../../tasks/utils/archive.js';
import type { FileOperations } from './file-operations.js';
import type { FormatHandler } from './format-handler.js';
import { getOwnKey, setOwnKey } from '../../../../common/utils/own-key.js';
import type { PathResolver } from './path-resolver.js';
import { filterReadyTasks } from '../../../tasks/utils/task-filters.js';
import { stampTasksFileSchemaVersion } from './schema-version.js';

/**
 * Tag-level operations extracted from FileStorage. Reads go back through the
 * storage instance so load behavior (complexity enrichment, schema checks) is shared.
 */
function tagNotFound(tag: string): TaskGraphError {
	return new TaskGraphError(
		`Tag "${tag}" does not exist`,
		ERROR_CODES.NOT_FOUND
	);
}

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
			const sourceTasks = options?.copyFrom
				? getOwnKey(data, options.copyFrom)?.tasks
				: undefined;
			const tasks = Array.isArray(sourceTasks)
				? JSON.parse(JSON.stringify(sourceTasks))
				: [];
			tasksCopied = tasks.length;
			const now = new Date().toISOString();
			setOwnKey(data, tagName, {
				tasks,
				metadata: {
					created: now,
					updated: now,
					description: options?.description
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
			const tasks = JSON.parse(
				JSON.stringify(Array.isArray(source.tasks) ? source.tasks : [])
			);
			tasksCopied = tasks.length;
			const now = new Date().toISOString();
			setOwnKey(data, targetTag, {
				tasks,
				metadata: {
					created: now,
					updated: now,
					description: options?.description,
					copiedFrom: { tag: sourceTag, date: now }
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
	 * Delete a tag and its archived tasks
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async deleteTag(tag: string): Promise<void> {
		await this.modifyTagged(this.pathResolver.getTasksPath(), (data) => {
			if (!Object.hasOwn(data, tag)) throw tagNotFound(tag);
			delete data[tag];
			return data;
		});
		await this.updateArchive((archive) => dropArchiveTag(archive, tag));
	}

	/**
	 * Rename a tag, noting the old name in its metadata, and move its
	 * archived tasks with it
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async renameTag(oldTag: string, newTag: string): Promise<void> {
		await this.modifyTagged(this.pathResolver.getTasksPath(), (data) => {
			if (!Object.hasOwn(data, oldTag)) throw tagNotFound(oldTag);
			// Checked under the lock: a tag created since the caller's check would be overwritten
			if (Object.hasOwn(data, newTag)) {
				throw new TaskGraphError(
					`Tag "${newTag}" already exists`,
					ERROR_CODES.VALIDATION_ERROR
				);
			}
			const tagData = { ...getOwnKey(data, oldTag) };
			if (tagData.metadata) {
				tagData.metadata = {
					...tagData.metadata,
					renamed: { from: oldTag, date: new Date().toISOString() }
				};
			}
			setOwnKey(data, newTag, tagData);
			delete data[oldTag];
			return data;
		});
		await this.updateArchive((archive) =>
			renameArchiveTag(archive, oldTag, newTag)
		);
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
	 * when there is none or the tag has nothing archived.
	 */
	private async updateArchive(
		change: (archive: ArchiveData) => ArchiveData | null
	): Promise<void> {
		const archivePath = this.pathResolver.getArchivePath();
		if (!(await this.fileOps.exists(archivePath))) return;
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
						await this.reader.loadArchivedTaskIds(tagName)
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
			return stateData?.currentTag || 'master';
		} catch (error) {
			// If state.json doesn't exist or can't be read, default to 'master'
			return 'master';
		}
	}
}
