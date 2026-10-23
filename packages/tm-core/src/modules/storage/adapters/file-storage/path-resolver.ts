/**
 * @fileoverview Path resolution utilities for single tasks.json file
 */

import path from 'node:path';
import { archivePathFor } from '../../../tasks/utils/archive.js';

/**
 * Handles path resolution for the single tasks.json file storage
 */
export class PathResolver {
	private readonly basePath: string;
	private readonly tasksDir: string;
	private readonly tasksFilePath: string;
	private readonly archiveFilePath: string;

	constructor(projectPath: string) {
		this.basePath = path.join(projectPath, '.taskgraph');
		this.tasksDir = path.join(this.basePath, 'tasks');
		this.tasksFilePath = path.join(this.tasksDir, 'tasks.json');
		this.archiveFilePath = archivePathFor(this.tasksFilePath);
	}

	/**
	 * Get the base storage directory path
	 */
	getBasePath(): string {
		return this.basePath;
	}

	/**
	 * Get the tasks directory path
	 */
	getTasksDir(): string {
		return this.tasksDir;
	}

	/**
	 * Get the path to the single tasks.json file
	 * All tags are stored in this one file
	 */
	getTasksPath(): string {
		return this.tasksFilePath;
	}

	/**
	 * Get the path to archive.json, where archived tasks of every tag live
	 */
	getArchivePath(): string {
		return this.archiveFilePath;
	}
}
