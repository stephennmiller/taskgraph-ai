/**
 * @fileoverview File operations with atomic writes and cross-process locking
 *
 * Writes go through a randomly named temp file that is renamed into place,
 * and proper-lockfile provides cross-process locking to prevent lost updates.
 */

import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import {
	ERROR_CODES,
	TaskGraphError
} from '../../../../common/errors/taskgraph-error.js';
import type { FileStorageData } from './format-handler.js';

/**
 * A file that exists but doesn't parse. The user message names the file the
 * way the user would type it and points at the line, which is what they need
 * to fix it by hand.
 */
function invalidJsonError(
	filePath: string,
	error: SyntaxError
): TaskGraphError {
	const relative = path.relative(process.cwd(), filePath);
	const shown =
		relative && !relative.startsWith('..') && !path.isAbsolute(relative)
			? relative
			: filePath;
	const position = /\(line (\d+) column (\d+)\)/.exec(error.message);
	const where = position ? ` (line ${position[1]}, column ${position[2]})` : '';

	return new TaskGraphError(
		`Invalid JSON in file ${filePath}: ${error.message}`,
		ERROR_CODES.JSON_PARSE_ERROR,
		{
			resource: filePath,
			userMessage: `${shown} isn't valid JSON${where}`
		},
		error
	);
}

/**
 * File locking configuration for cross-process safety
 */
const LOCK_OPTIONS = {
	stale: 10000, // Consider lock stale after 10 seconds
	retries: {
		retries: 5,
		factor: 2,
		minTimeout: 100,
		maxTimeout: 1000
	},
	realpath: false // Don't resolve symlinks (faster)
};

/**
 * Refuse a file that is a symlink, so a write can't be pointed elsewhere (#616)
 */
async function refuseSymlink(filePath: string): Promise<void> {
	const info = await fs.lstat(filePath).catch((err: any) => {
		if (err.code === 'ENOENT') return null;
		throw err;
	});
	if (info?.isSymbolicLink()) {
		throw new TaskGraphError(
			`Refusing to write ${filePath}: it is a symlink`,
			ERROR_CODES.FILE_WRITE_ERROR,
			{
				resource: filePath,
				userMessage: `${filePath} is a symlink; TaskGraph won't write through it. Replace it with a regular file.`
			}
		);
	}
}

/**
 * Replace a file atomically. The temp file gets a random name and is created
 * with O_CREAT|O_EXCL, so a symlink planted next to the file can't redirect
 * the write (#616).
 */
async function writeFileAtomic(
	filePath: string,
	content: string
): Promise<void> {
	const tempPath = path.join(
		path.dirname(filePath),
		`.${path.basename(filePath)}.${randomBytes(8).toString('hex')}.tmp`
	);
	try {
		await fs.writeFile(tempPath, content, { flag: 'wx' });
		await fs.rename(tempPath, filePath);
	} catch (err) {
		await fs.rm(tempPath, { force: true }).catch(() => undefined);
		throw err;
	}
}

/**
 * Handles atomic file operations with cross-process locking mechanism.
 */
export class FileOperations {
	/**
	 * Read and parse JSON file
	 */
	async readJson(filePath: string): Promise<any> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			return JSON.parse(content);
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw error; // Re-throw ENOENT for caller to handle
			}
			if (error instanceof SyntaxError) {
				throw invalidJsonError(filePath, error);
			}
			throw new Error(`Failed to read file ${filePath}: ${error.message}`);
		}
	}

	/**
	 * Take the cross-process lock. The legacy scripts keep `<file>.lock` as a
	 * plain file, but proper-lockfile needs a directory there and fails with
	 * ENOTDIR when it tries to expire a crashed writer's file. Move a stale
	 * lock file aside first; a fresh one is left, so its owner still blocks us.
	 * Every write takes this lock, so a symlinked file is refused here.
	 */
	private async acquireLock(filePath: string): Promise<() => Promise<void>> {
		await refuseSymlink(filePath);
		const lockPath = `${filePath}.lock`;
		try {
			const info = await fs.lstat(lockPath);
			if (
				!info.isDirectory() &&
				Date.now() - info.mtimeMs > LOCK_OPTIONS.stale
			) {
				const aside = `${lockPath}.stale.${process.pid}.${Date.now()}`;
				// A concurrent writer may already have moved it; that is fine
				await fs.rename(lockPath, aside).catch(() => undefined);
				await fs.rm(aside, { force: true });
			}
		} catch (err: any) {
			if (err.code !== 'ENOENT') throw err;
		}
		return lockfile.lock(filePath, LOCK_OPTIONS);
	}

	/**
	 * Write JSON file with atomic operation and cross-process locking.
	 * Writes atomically (see writeFileAtomic) under a proper-lockfile lock.
	 * WARNING: This replaces the entire file. For concurrent modifications,
	 * use modifyJson() instead to prevent lost updates.
	 */
	async writeJson(
		filePath: string,
		data: FileStorageData | any
	): Promise<void> {
		// Ensure file exists for locking (proper-lockfile requires this)
		await this.ensureFileExists(filePath);

		// Acquire cross-process lock
		let release: (() => Promise<void>) | null = null;
		try {
			release = await this.acquireLock(filePath);

			await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
		} finally {
			if (release) {
				try {
					await release();
				} catch (err: any) {
					// Log but don't throw - lock may have been released already
					// Other errors should be visible for debugging
					if (process.env.DEBUG || process.env.TASKGRAPH_DEBUG === 'true') {
						console.warn(
							`[WARN] Lock release warning for ${filePath}: ${err.message}`
						);
					}
				}
			}
		}
	}

	/**
	 * Read-modify-write JSON file with cross-process locking.
	 * Writes atomically (see writeFileAtomic) under a proper-lockfile lock.
	 * Re-reads file inside lock to prevent lost updates from stale snapshots.
	 * @param filePath - Path to the JSON file
	 * @param modifier - Function that receives current data and returns modified data
	 * @param options.afterWrite - Runs after the write, before the lock is
	 *   released (to update a second file in step with this one)
	 */
	async modifyJson<T = any>(
		filePath: string,
		modifier: (currentData: T) => T | Promise<T>,
		options: { afterWrite?: () => Promise<void> } = {}
	): Promise<void> {
		// Ensure file exists for locking (proper-lockfile requires this)
		await this.ensureFileExists(filePath);

		// Acquire cross-process lock
		let release: (() => Promise<void>) | null = null;
		try {
			release = await this.acquireLock(filePath);

			// Re-read file INSIDE lock to get current state
			// This prevents lost updates from stale snapshots
			let currentData: T;
			try {
				const content = await fs.readFile(filePath, 'utf-8');
				currentData = JSON.parse(content);
			} catch (err: any) {
				// Distinguish between expected empty/new files and actual corruption
				if (err.code === 'ENOENT') {
					// File doesn't exist yet - start fresh
					currentData = {} as T;
				} else if (err instanceof SyntaxError) {
					// Check if it's just an empty file (our ensureFileExists writes '{}')
					const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
					if (content.trim() === '' || content.trim() === '{}') {
						currentData = {} as T;
					} else {
						// Actual JSON corruption - this is a serious error
						throw new Error(
							`Corrupted JSON in ${filePath}: ${err.message}. File contains: ${content.substring(0, 100)}...`
						);
					}
				} else {
					// Other errors (permission, I/O) should be surfaced
					throw new Error(
						`Failed to read ${filePath} for modification: ${err.message}`
					);
				}
			}

			// Apply modification
			const newData = await modifier(currentData);

			await writeFileAtomic(filePath, JSON.stringify(newData, null, 2));
			await options.afterWrite?.();
		} finally {
			if (release) {
				try {
					await release();
				} catch (err: any) {
					// Log but don't throw - lock may have been released already
					// Other errors should be visible for debugging
					if (process.env.DEBUG || process.env.TASKGRAPH_DEBUG === 'true') {
						console.warn(
							`[WARN] Lock release warning for ${filePath}: ${err.message}`
						);
					}
				}
			}
		}
	}

	/**
	 * Ensure file exists for locking (proper-lockfile requires the file to exist).
	 * Uses atomic creation with 'wx' flag to prevent TOCTOU race conditions.
	 */
	private async ensureFileExists(filePath: string): Promise<void> {
		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });
		try {
			// Use 'wx' flag for atomic create - fails if file exists (prevents race)
			await fs.writeFile(filePath, '{}', { flag: 'wx' });
		} catch (err: any) {
			// EEXIST is expected if another process created the file - that's fine
			if (err.code !== 'EEXIST') {
				throw err;
			}
		}
	}

	/**
	 * Check if file exists
	 */
	async exists(filePath: string): Promise<boolean> {
		try {
			await fs.access(filePath, constants.F_OK);
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get file stats
	 */
	async getStats(filePath: string) {
		return fs.stat(filePath);
	}

	/**
	 * Read directory contents
	 */
	async readDir(dirPath: string): Promise<string[]> {
		return fs.readdir(dirPath);
	}

	/**
	 * Create directory recursively
	 */
	async ensureDir(dirPath: string): Promise<void> {
		try {
			await fs.mkdir(dirPath, { recursive: true });
		} catch (error: any) {
			throw new Error(
				`Failed to create directory ${dirPath}: ${error.message}`
			);
		}
	}

	/**
	 * Delete file
	 */
	async deleteFile(filePath: string): Promise<void> {
		try {
			await fs.unlink(filePath);
		} catch (error: any) {
			if (error.code !== 'ENOENT') {
				throw new Error(`Failed to delete file ${filePath}: ${error.message}`);
			}
		}
	}

	/**
	 * Rename/move file
	 */
	async moveFile(oldPath: string, newPath: string): Promise<void> {
		try {
			await fs.rename(oldPath, newPath);
		} catch (error: any) {
			throw new Error(
				`Failed to move file from ${oldPath} to ${newPath}: ${error.message}`
			);
		}
	}

	/**
	 * Copy file
	 */
	async copyFile(srcPath: string, destPath: string): Promise<void> {
		try {
			await fs.copyFile(srcPath, destPath);
		} catch (error: any) {
			throw new Error(
				`Failed to copy file from ${srcPath} to ${destPath}: ${error.message}`
			);
		}
	}

	/**
	 * Release resources. Nothing is cached now; kept for callers that dispose
	 * of instances.
	 */
	async cleanup(): Promise<void> {}
}
