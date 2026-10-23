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
	dropArchiveTag,
	renameArchiveTag
} from '../../../tasks/utils/archive.js';
import type { FileOperations } from './file-operations.js';
import type { FormatHandler } from './format-handler.js';
import type { PathResolver } from './path-resolver.js';
import { filterReadyTasks } from '../../../tasks/utils/task-filters.js';
import { withSchemaVersion } from './schema-version.js';

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
			'loadTasks' | 'loadMetadata' | 'getAllTags'
		>
	) {}

	/**
	 * Create a new tag in the tasks.json file
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async createTag(
		tagName: string,
		options?: { copyFrom?: string; description?: string }
	): Promise<void> {
		const filePath = this.pathResolver.getTasksPath();

		try {
			await this.fileOps.modifyJson(filePath, (existingData: any) => {
				const format = this.formatHandler.detectFormat(existingData);

				if (format === 'legacy') {
					// Legacy format - add new tag key
					if (tagName in existingData) {
						throw new TaskGraphError(
							`Tag ${tagName} already exists`,
							ERROR_CODES.VALIDATION_ERROR
						);
					}

					// Get tasks to copy if specified
					let tasksToCopy: any[] = [];
					if (options?.copyFrom) {
						if (
							options.copyFrom in existingData &&
							existingData[options.copyFrom].tasks
						) {
							tasksToCopy = JSON.parse(
								JSON.stringify(existingData[options.copyFrom].tasks)
							);
						}
					}

					// Create new tag structure
					existingData[tagName] = {
						tasks: tasksToCopy,
						metadata: withSchemaVersion({
							created: new Date().toISOString(),
							updatedAt: new Date().toISOString(),
							description:
								options?.description ||
								`Tag created on ${new Date().toLocaleDateString()}`,
							tags: [tagName]
						})
					};

					return existingData;
				} else {
					// Standard format - need to convert to legacy format first
					const masterTasks = existingData.tasks || [];
					const masterMetadata = existingData.metadata || {};

					// Get tasks to copy (from master in this case)
					let tasksToCopy: any[] = [];
					if (options?.copyFrom === 'master' || !options?.copyFrom) {
						tasksToCopy = JSON.parse(JSON.stringify(masterTasks));
					}

					return {
						master: {
							tasks: masterTasks,
							metadata: withSchemaVersion(
								{ ...masterMetadata, tags: ['master'] },
								masterMetadata
							)
						},
						[tagName]: {
							tasks: tasksToCopy,
							metadata: withSchemaVersion({
								created: new Date().toISOString(),
								updatedAt: new Date().toISOString(),
								description:
									options?.description ||
									`Tag created on ${new Date().toLocaleDateString()}`,
								tags: [tagName]
							})
						}
					};
				}
			});
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw new Error('Tasks file not found - initialize project first');
			}
			throw error;
		}
	}

	/**
	 * Delete a tag from the single tasks.json file
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async deleteTag(tag: string): Promise<void> {
		const filePath = this.pathResolver.getTasksPath();

		try {
			// Use modifyJson to handle all cases atomically
			let shouldDeleteFile = false;

			await this.fileOps.modifyJson(filePath, (data: any) => {
				if (
					this.formatHandler.detectFormat(data) !== 'legacy' &&
					tag === 'master'
				) {
					// Standard format - mark for file deletion after lock release
					shouldDeleteFile = true;
					return data; // Return unchanged, we'll delete the file after
				}

				if (this.formatHandler.detectFormat(data) === 'legacy') {
					// Legacy format - remove the tag key
					if (tag in data) {
						delete data[tag];
						return data;
					} else {
						throw new Error(`Tag ${tag} not found`);
					}
				} else {
					throw new Error(`Tag ${tag} not found in standard format`);
				}
			});

			// Delete the file if we're removing master tag from standard format
			if (shouldDeleteFile) {
				await this.fileOps.deleteFile(filePath);
			}
			// Its archived tasks go with it
			await this.updateArchive((archive) => dropArchiveTag(archive, tag));
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw new Error(`Tag ${tag} not found - file doesn't exist`);
			}
			throw error;
		}
	}

	/**
	 * Rename a tag within the single tasks.json file
	 * Uses modifyJson for atomic read-modify-write to prevent lost updates
	 */
	async renameTag(oldTag: string, newTag: string): Promise<void> {
		const filePath = this.pathResolver.getTasksPath();

		try {
			await this.fileOps.modifyJson(filePath, (existingData: any) => {
				if (this.formatHandler.detectFormat(existingData) === 'legacy') {
					// Legacy format - rename the tag key
					if (oldTag in existingData) {
						existingData[newTag] = existingData[oldTag];
						delete existingData[oldTag];

						// Update metadata tags array
						if (existingData[newTag].metadata) {
							existingData[newTag].metadata.tags = [newTag];
						}

						return existingData;
					} else {
						throw new Error(`Tag ${oldTag} not found`);
					}
				} else if (oldTag === 'master') {
					// Convert standard format to legacy when renaming master
					const masterTasks = existingData.tasks || [];
					const masterMetadata = existingData.metadata || {};

					return {
						[newTag]: {
							tasks: masterTasks,
							metadata: withSchemaVersion(
								{ ...masterMetadata, tags: [newTag] },
								masterMetadata
							)
						}
					};
				} else {
					throw new Error(`Tag ${oldTag} not found in standard format`);
				}
			});
			// Its archived tasks move with it
			await this.updateArchive((archive) =>
				renameArchiveTag(archive, oldTag, newTag)
			);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw new Error(`Tag ${oldTag} not found - file doesn't exist`);
			}
			throw error;
		}
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

					// Ready: actionable, with every dependency complete
					const readyTasks = filterReadyTasks(
						tasks.map((task) => ({ ...task, blocks: [] }))
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
