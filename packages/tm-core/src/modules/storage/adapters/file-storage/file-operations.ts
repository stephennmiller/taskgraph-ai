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
 * File locking configuration for cross-process safety.
 *
 * Writers in this process do not compete for these retries: `enqueueWrite`
 * runs one of them at a time, and the next takes the lock only after the
 * previous one has released it. The budget is what another process waits.
 */
const LOCK_OPTIONS = {
	stale: 10000, // Consider lock stale after 10 seconds
	// About 10 s: another process (the CLI next to a busy MCP server) can wait
	// behind several writes in a row (#697). Randomized so waiters don't retry in step
	retries: {
		retries: 14,
		factor: 2,
		minTimeout: 100,
		maxTimeout: 1000,
		randomize: true
	},
	realpath: false // Don't resolve symlinks (faster)
};

/**
 * Tail of the in-process write queue for one resolved path. One MCP server
 * runs tool calls at the same time, and each call builds its own
 * FileOperations, so the queue has to live on the module. A failed write
 * does not block the rest: the tail always settles.
 */
const writeQueueTails = new Map<string, Promise<void>>();

function enqueueWrite<T>(
	filePath: string,
	write: () => Promise<T>
): Promise<T> {
	const key = path.resolve(filePath);
	const previous = writeQueueTails.get(key) ?? Promise.resolve();
	const run = previous.then(write);
	const tail = run.then(
		() => undefined,
		() => undefined
	);
	writeQueueTails.set(key, tail);
	void tail.then(() => {
		if (writeQueueTails.get(key) === tail) writeQueueTails.delete(key);
	});
	return run;
}

/**
 * Refuse a file or folder that is a symlink, so a write can't be pointed
 * elsewhere (#616)
 */
export async function refuseSymlink(filePath: string): Promise<void> {
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
				userMessage: `${filePath} is a symlink; TaskGraph won't write through it. Replace it with a regular file or folder.`
			}
		);
	}
}

/**
 * On Windows, renaming over a file another process has open (an antivirus
 * scan, an editor) fails briefly with EPERM/EACCES/EBUSY. Retry as steno did:
 * up to 10 tries, 100 ms apart.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fs.rename(from, to);
		} catch (err: any) {
			if (attempt >= 10 || !RENAME_RETRY_CODES.has(err?.code)) throw err;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	}
}

const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

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
		await renameWithRetry(tempPath, filePath);
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
				// A concurrent writer may already have moved it; that is fine.
				// Anything else (EACCES) surfaces here instead of as proper-lockfile's ENOTDIR
				await fs.rename(lockPath, aside).catch((err) => {
					if (err.code !== 'ENOENT') throw err;
				});
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
		await enqueueWrite(filePath, () => this.writeJsonExclusive(filePath, data));
	}

	/**
	 * writeJson while this process's queue for filePath is held.
	 */
	private async writeJsonExclusive(
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
		await enqueueWrite(filePath, () =>
			this.modifyJsonExclusive(filePath, modifier, options)
		);
	}

	/**
	 * modifyJson while this process's queue for filePath is held.
	 * A modifier must not call back into this file: the queue (and the file
	 * lock) are already held, so that call would wait for itself.
	 */
	private async modifyJsonExclusive<T = any>(
		filePath: string,
		modifier: (currentData: T) => T | Promise<T>,
		options: { afterWrite?: () => Promise<void> } = {}
	): Promise<void> {
		// Ensure file exists for locking (proper-lockfile requires this)
		const created = await this.ensureFileExists(filePath);

		// Acquire cross-process lock
		let release: (() => Promise<void>) | null = null;
		let written = false;
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
			const json = JSON.stringify(newData, null, 2);

			// Nothing to store in a file we created only to lock it (#704)
			if (created && json === '{}') {
				await this.removePlaceholder(filePath);
			} else {
				await writeFileAtomic(filePath, json);
				written = true;
			}
			await options.afterWrite?.();
		} catch (err) {
			// Don't leave our '{}' placeholder behind (#667)
			if (created && !written && release)
				await this.removePlaceholder(filePath);
			throw err;
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
	 * Remove the '{}' that ensureFileExists created. Call it under the lock;
	 * it keeps a file another process filled before we locked it.
	 */
	private async removePlaceholder(filePath: string): Promise<void> {
		const content = await fs.readFile(filePath, 'utf-8').catch(() => '');
		// A failed rm (Windows EPERM) must not hide the caller's error
		if (content.trim() === '{}')
			await fs.rm(filePath, { force: true }).catch(() => undefined);
	}

	/**
	 * Ensure file exists for locking (proper-lockfile requires the file to exist).
	 * Uses atomic creation with 'wx' flag to prevent TOCTOU race conditions.
	 * Returns true when this call created the file.
	 */
	private async ensureFileExists(filePath: string): Promise<boolean> {
		const dir = path.dirname(filePath);
		await fs.mkdir(dir, { recursive: true });
		try {
			// Use 'wx' flag for atomic create - fails if file exists (prevents race)
			await fs.writeFile(filePath, '{}', { flag: 'wx' });
			return true;
		} catch (err: any) {
			// EEXIST is expected if another process created the file - that's fine
			if (err.code !== 'EEXIST') {
				throw err;
			}
			return false;
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
}
