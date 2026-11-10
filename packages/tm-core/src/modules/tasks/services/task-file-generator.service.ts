/**
 * @fileoverview Task file generator service
 * Generates individual markdown task files from tasks.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Task, Subtask, TaskStatus } from '../../../common/types/index.js';
import type { IStorage } from '../../../common/interfaces/storage.interface.js';
import type { ConfigManager } from '../../config/managers/config-manager.js';
import { resolveSubtaskDependency } from '../../dependencies/subtask-dependency.js';
import { isSafeTaskId } from '../../../common/utils/safe-task-id.js';
import {
	makeProjectDir,
	refuseSymlinkedFolders,
	removeProjectFile,
	renameProjectFile,
	writeProjectFile
} from '../../storage/adapters/file-storage/file-operations.js';
import { TAG_NAME_PATTERN, assertTagName } from '../utils/tag-names.js';

/**
 * Options for generating task files
 */
export interface GenerateTaskFilesOptions {
	/** Tag context for the tasks */
	tag?: string;
	/** Output directory for generated files (defaults to tasks directory) */
	outputDir?: string;
}

/**
 * Result of task file generation
 */
export interface GenerateTaskFilesResult {
	success: boolean;
	/** Number of task files successfully generated */
	count: number;
	/** Output directory where files were written */
	directory: string;
	/** Number of orphaned files cleaned up */
	orphanedFilesRemoved: number;
	/** Error message if generation failed completely */
	error?: string;
	/** Individual file write errors (task ID -> error message) */
	fileErrors?: Record<string, string>;
}

/**
 * The file `generate` writes for a task, which `remove-task` deletes:
 * task_001.md in master, task_001_<tag>.md in other tags
 */
function taskFileName(taskId: string | number, tag: string): string {
	assertTagName(tag);
	const paddedId = String(taskId).padStart(3, '0');
	return tag === 'master'
		? `task_${paddedId}.md`
		: `task_${paddedId}_${tag}.md`;
}

/**
 * The files in `dir` named as `generate` names a tag's task files, with the
 * task number each holds. Any other file there is someone else's.
 */
function taskFilesIn(
	dir: string,
	tag: string
): Array<{ file: string; id: string }> {
	// A valid tag name has no regex characters
	const pattern =
		tag === 'master'
			? /^task_(\d+)\.md$/
			: new RegExp(`^task_(\\d+)_${tag}\\.md$`);
	return fs.readdirSync(dir).flatMap((file) => {
		const match = file.match(pattern);
		return match ? [{ file, id: String(Number.parseInt(match[1], 10)) }] : [];
	});
}

/** What a cleanup deleted, and what it couldn't, as full paths and messages */
export interface RemovedTaskFiles {
	removed: string[];
	errors: string[];
}

/**
 * Delete a tag's generated files in `dir` whose task number `remove`
 * accepts. `root` is the folder no link may lead out of (see removeProjectFile)
 */
function removeTaskFilesIn(
	root: string,
	dir: string,
	tag: string,
	remove: (id: string) => boolean
): RemovedTaskFiles {
	const result: RemovedTaskFiles = { removed: [], errors: [] };
	for (const { file, id } of taskFilesIn(dir, tag)) {
		if (!remove(id)) continue;
		const target = path.join(dir, file);
		try {
			removeProjectFile(root, path.resolve(target));
			result.removed.push(target);
		} catch (error) {
			// The file is a copy of tasks.json; one left behind loses nothing
			result.errors.push(
				`Failed to delete task file ${target}: ${(error as Error).message}`
			);
		}
	}
	return result;
}

/**
 * The folder `generate` writes to by default, or undefined when the tag
 * can't name a file (generate refuses it, so it has none) or the folder is
 * missing or reached through a symlink
 */
function defaultTaskFilesDir(
	projectRoot: string,
	...tags: string[]
): string | undefined {
	if (!tags.every((tag) => TAG_NAME_PATTERN.test(tag))) return undefined;
	const dir = path.join(projectRoot, '.taskgraph', 'tasks');
	try {
		refuseSymlinkedFolders(path.join(dir, 'task.md'));
		return fs.statSync(dir).isDirectory() ? dir : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Delete the files `generate` wrote for a tag in the default folder: all of
 * them (the tag was removed), or those of `taskIds` (removed or archived
 * tasks). Runs after tasks.json is saved and never throws.
 */
export function removeGeneratedTaskFiles(
	projectRoot: string,
	tag: string,
	taskIds?: Iterable<string | number>
): RemovedTaskFiles {
	const dir = defaultTaskFilesDir(projectRoot, tag);
	if (!dir) return { removed: [], errors: [] };
	const ids = taskIds && new Set([...taskIds].map(String));
	try {
		return removeTaskFilesIn(
			projectRoot,
			dir,
			tag,
			(id) => !ids || ids.has(id)
		);
	} catch {
		return { removed: [], errors: [] };
	}
}

/**
 * Rename a renamed tag's generated files in the default folder to the new
 * tag's names. A file already under a new name is never replaced: it may be
 * someone's own, so the old one, a copy of tasks.json, is deleted instead.
 * Never throws.
 */
export function renameGeneratedTaskFiles(
	projectRoot: string,
	oldTag: string,
	newTag: string
): void {
	const dir = defaultTaskFilesDir(projectRoot, oldTag, newTag);
	if (!dir) return;
	try {
		// Without case: macOS and Windows folders hold one file per spelling
		const names = fs.readdirSync(dir).map((name) => name.toLowerCase());
		for (const { file, id } of taskFilesIn(dir, oldTag)) {
			const renamed = taskFileName(id, newTag);
			const taken =
				renamed.toLowerCase() !== file.toLowerCase() &&
				names.includes(renamed.toLowerCase());
			try {
				if (taken) removeProjectFile(projectRoot, path.join(dir, file));
				else {
					renameProjectFile(
						projectRoot,
						path.join(dir, file),
						path.join(dir, renamed)
					);
				}
				names.push(renamed.toLowerCase());
			} catch {
				// A file left under the old name loses nothing; go on to the rest
			}
		}
	} catch {
		// As above
	}
}

/**
 * Service for generating individual task markdown files from tasks.json
 */
export class TaskFileGeneratorService {
	constructor(
		private storage: IStorage,
		private projectPath: string,
		private configManager: ConfigManager
	) {}

	/**
	 * Generate individual task files from storage
	 * - Reads tasks from storage
	 * - Cleans up orphaned task files
	 * - Writes individual markdown files for each task
	 */
	async generateTaskFiles(
		options: GenerateTaskFilesOptions = {}
	): Promise<GenerateTaskFilesResult> {
		const tag = options.tag || this.configManager.getActiveTag();
		const outputDir =
			options.outputDir || path.join(this.projectPath, '.taskgraph', 'tasks');
		// A folder the user named may be a link; the default one may not
		const root = options.outputDir ? outputDir : this.projectPath;

		try {
			// The tag goes into each file name
			assertTagName(tag);
			// Writes and orphan cleanup must not follow a symlinked default
			// folder, or a symlinked .taskgraph above it
			makeProjectDir(root, path.resolve(outputDir));

			// Load tasks from storage
			const tasks = await this.storage.loadTasks(tag);

			// Clean up orphaned task files, also when the tag has no tasks left
			const validTaskIds = new Set(tasks.map((task) => String(task.id)));
			let orphanedCount = 0;
			try {
				orphanedCount = removeTaskFilesIn(
					root,
					outputDir,
					tag,
					(id) => !validTaskIds.has(id)
				).removed.length;
			} catch {
				// Cleanup is best effort
			}

			// Generate task files in parallel with individual error handling
			// This allows partial success - some files can be written even if others fail
			const fileErrors: Record<string, string> = {};
			const results = await Promise.allSettled(
				tasks.map(async (task) => {
					// The ID goes into the file name, and a hand-edited one can hold ../
					if (!isSafeTaskId(String(task.id))) {
						throw new Error(
							`Task ID ${JSON.stringify(String(task.id))} can't be used in a file name`
						);
					}
					const content = this.formatTaskContent(task, tasks);
					const fileName = taskFileName(task.id, tag);
					const filePath = path.join(outputDir, fileName);
					writeProjectFile(root, path.resolve(filePath), content);
					return task.id;
				})
			);

			// Count successes and collect errors
			let successCount = 0;
			for (let i = 0; i < results.length; i++) {
				const result = results[i];
				if (result.status === 'fulfilled') {
					successCount++;
				} else {
					const taskId = String(tasks[i].id);
					fileErrors[taskId] = result.reason?.message || 'Unknown error';
				}
			}

			return {
				success: Object.keys(fileErrors).length === 0,
				count: successCount,
				directory: outputDir,
				orphanedFilesRemoved: orphanedCount,
				...(Object.keys(fileErrors).length > 0 && { fileErrors })
			};
		} catch (error: any) {
			return {
				success: false,
				count: 0,
				directory: outputDir,
				orphanedFilesRemoved: 0,
				error: error.message
			};
		}
	}

	/**
	 * Format a task into markdown content for the task file
	 * Uses single H1 title with metadata as key-value pairs
	 */
	private formatTaskContent(task: Task, allTasks: Task[]): string {
		// Single H1 title with task ID
		let content = `# Task ID: ${task.id}\n\n`;

		// Metadata as key-value pairs (using bold for keys)
		content += `**Title:** ${task.title}\n\n`;
		content += `**Status:** ${task.status || 'pending'}\n\n`;

		// Format dependencies with status
		if (task.dependencies && task.dependencies.length > 0) {
			const depsWithStatus = this.formatDependenciesWithStatus(
				task.dependencies,
				allTasks
			);
			content += `**Dependencies:** ${depsWithStatus}\n\n`;
		} else {
			content += '**Dependencies:** None\n\n';
		}

		content += `**Priority:** ${task.priority || 'medium'}\n\n`;
		content += `**Description:** ${task.description || ''}\n\n`;

		// Details section
		content += '**Details:**\n\n';
		content += `${task.details || 'No details provided.'}\n\n`;

		// Test Strategy section
		content += '**Test Strategy:**\n\n';
		content += `${task.testStrategy || 'No test strategy provided.'}\n`;

		// Add subtasks if present
		if (task.subtasks && task.subtasks.length > 0) {
			content += '\n## Subtasks\n';
			for (const subtask of task.subtasks) {
				content += this.formatSubtaskContent(subtask, task);
			}
		}

		// Normalize multiple blank lines to single blank lines
		return content.replace(/\n{3,}/g, '\n\n');
	}

	/**
	 * Format a subtask into markdown content
	 */
	private formatSubtaskContent(subtask: Subtask, parentTask: Task): string {
		// H3 for subtask title since H2 is used for sections
		let content = `\n### ${parentTask.id}.${subtask.id}. ${subtask.title}\n\n`;

		// Metadata using bold labels
		content += `**Status:** ${subtask.status || 'pending'}  \n`;

		// Format subtask dependencies
		if (subtask.dependencies && subtask.dependencies.length > 0) {
			const subtaskDeps = subtask.dependencies
				.map((depId) => resolveSubtaskDependency(parentTask.id, depId))
				.join(', ');
			content += `**Dependencies:** ${subtaskDeps}  \n`;
		} else {
			content += '**Dependencies:** None  \n';
		}

		content += '\n';

		if (subtask.description) {
			content += `${subtask.description}\n`;
		}

		if (subtask.details) {
			content += `\n**Details:**\n\n${subtask.details}\n`;
		}

		return content;
	}

	/**
	 * Format dependencies with their current status
	 */
	private formatDependenciesWithStatus(
		dependencies: (string | number)[],
		allTasks: Task[]
	): string {
		return dependencies
			.map((depId) => {
				const depTask = allTasks.find((t) => String(t.id) === String(depId));
				if (depTask) {
					const statusSymbol = this.getStatusSymbol(depTask.status);
					return `${depId}${statusSymbol}`;
				}
				return String(depId);
			})
			.join(', ');
	}

	/**
	 * Get status symbol for display
	 */
	private getStatusSymbol(status: TaskStatus | undefined): string {
		switch (status) {
			case 'done':
				return ' ✓';
			case 'in-progress':
				return ' ⧖';
			case 'blocked':
				return ' ⛔';
			case 'cancelled':
				return ' ✗';
			case 'deferred':
				return ' ⏸';
			default:
				return '';
		}
	}
}
