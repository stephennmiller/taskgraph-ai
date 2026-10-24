/**
 * Tests for FileOperations class
 * Focuses on modifyJson and cross-process locking functionality
 */

import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileOperations } from './file-operations.js';

describe('FileOperations', () => {
	let tempDir: string;
	let testFilePath: string;
	let fileOps: FileOperations;

	beforeEach(async () => {
		// Create a temp directory for each test
		tempDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'tm-core-test-'));
		testFilePath = path.join(tempDir, 'test.json');
		fileOps = new FileOperations();
	});

	afterEach(async () => {
		if (tempDir && fsSync.existsSync(tempDir)) {
			fsSync.rmSync(tempDir, { recursive: true, force: true });
		}
	});

	describe('modifyJson', () => {
		it('should modify existing JSON data', async () => {
			// Set up initial data
			await fs.writeFile(testFilePath, JSON.stringify({ count: 0 }));

			// Modify data
			await fileOps.modifyJson(testFilePath, (data: { count: number }) => ({
				...data,
				count: data.count + 1
			}));

			// Verify
			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.count).toBe(1);
		});

		it('should create file if it does not exist', async () => {
			const newFilePath = path.join(tempDir, 'new-file.json');

			await fileOps.modifyJson(newFilePath, () => ({ created: true }));

			expect(fsSync.existsSync(newFilePath)).toBe(true);
			const result = JSON.parse(await fs.readFile(newFilePath, 'utf-8'));
			expect(result.created).toBe(true);
		});

		it('should handle async modifier functions', async () => {
			await fs.writeFile(testFilePath, JSON.stringify({ value: 'initial' }));

			await fileOps.modifyJson(
				testFilePath,
				async (data: { value: string }) => {
					// Simulate async operation
					await new Promise((resolve) => setTimeout(resolve, 10));
					return { ...data, value: 'modified' };
				}
			);

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.value).toBe('modified');
		});

		it('should re-read file inside lock to prevent stale data', async () => {
			// Initial data
			await fs.writeFile(testFilePath, JSON.stringify({ version: 1 }));

			// Simulate two sequential modifications
			await fileOps.modifyJson(testFilePath, (data: { version: number }) => ({
				version: data.version + 1
			}));

			await fileOps.modifyJson(testFilePath, (data: { version: number }) => ({
				version: data.version + 1
			}));

			// Both modifications should have been applied
			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.version).toBe(3);
		});

		it('should not leave lock files on success', async () => {
			await fs.writeFile(testFilePath, JSON.stringify({}));

			await fileOps.modifyJson(testFilePath, (data) => ({
				...data,
				modified: true
			}));

			// Check no lock files exist
			const files = await fs.readdir(tempDir);
			const lockFiles = files.filter((f) => f.endsWith('.lock'));
			expect(lockFiles).toHaveLength(0);
		});

		it('should release lock even if modifier throws', async () => {
			await fs.writeFile(testFilePath, JSON.stringify({}));

			await expect(
				fileOps.modifyJson(testFilePath, () => {
					throw new Error('Modifier error');
				})
			).rejects.toThrow('Modifier error');

			// Should still be able to acquire lock for another operation
			await fileOps.modifyJson(testFilePath, () => ({ recovered: true }));

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.recovered).toBe(true);
		});

		it('should handle empty file gracefully', async () => {
			// Create empty file
			await fs.writeFile(testFilePath, '');

			await fileOps.modifyJson(testFilePath, () => ({ initialized: true }));

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.initialized).toBe(true);
		});

		it('should handle file with only whitespace', async () => {
			await fs.writeFile(testFilePath, '   \n  ');

			await fileOps.modifyJson(testFilePath, () => ({ initialized: true }));

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.initialized).toBe(true);
		});

		it('should throw on corrupted JSON', async () => {
			// Write invalid JSON that is not empty
			await fs.writeFile(testFilePath, '{ invalid json content');

			await expect(
				fileOps.modifyJson(testFilePath, (data) => data)
			).rejects.toThrow(/Corrupted JSON/);
		});

		it('should preserve complex nested structures', async () => {
			const complexData = {
				tasks: [
					{
						id: 1,
						title: 'Task 1',
						subtasks: [{ id: '1.1', title: 'Subtask' }]
					}
				],
				metadata: {
					created: '2024-01-01',
					tags: ['tag1', 'tag2']
				}
			};
			await fs.writeFile(testFilePath, JSON.stringify(complexData, null, 2));

			await fileOps.modifyJson(testFilePath, (data: typeof complexData) => ({
				...data,
				tasks: [...data.tasks, { id: 2, title: 'Task 2', subtasks: [] }]
			}));

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.tasks).toHaveLength(2);
			expect(result.tasks[0].subtasks).toHaveLength(1);
			expect(result.metadata.tags).toEqual(['tag1', 'tag2']);
		});
	});

	describe('concurrent operations', () => {
		it('should serialize truly concurrent modifyJson calls', async () => {
			// Initial data
			await fs.writeFile(testFilePath, JSON.stringify({ count: 0 }));

			const numConcurrentWrites = 5;
			const writes = [];

			for (let i = 0; i < numConcurrentWrites; i++) {
				writes.push(
					fileOps.modifyJson(testFilePath, (data: { count: number }) => ({
						count: data.count + 1
					}))
				);
			}

			await Promise.all(writes);

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.count).toBe(numConcurrentWrites);
		});

		it('should handle concurrent writes from multiple FileOperations instances', async () => {
			// Initial data
			await fs.writeFile(testFilePath, JSON.stringify({ count: 0 }));

			const numInstances = 3;
			const instances = Array.from(
				{ length: numInstances },
				() => new FileOperations()
			);
			const writes = instances.map((ops) =>
				ops.modifyJson(testFilePath, (data: { count: number }) => ({
					count: data.count + 1
				}))
			);

			await Promise.all(writes);

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.count).toBe(numInstances);
		});
	});

	describe('writeJson', () => {
		it('should write JSON atomically', async () => {
			const data = { test: 'value' };

			await fileOps.writeJson(testFilePath, data);

			const result = JSON.parse(await fs.readFile(testFilePath, 'utf-8'));
			expect(result.test).toBe('value');
		});

		it('should not leave temp files on success', async () => {
			await fileOps.writeJson(testFilePath, { test: true });

			const files = await fs.readdir(tempDir);
			const tempFiles = files.filter((f) => f.includes('.tmp'));
			expect(tempFiles).toHaveLength(0);

			// Also verify no lock files remain
			const lockFiles = files.filter((f) => f.endsWith('.lock'));
			expect(lockFiles).toHaveLength(0);
		});
	});

	describe('symlinks (#616)', () => {
		let outside: string;

		beforeEach(() => {
			outside = path.join(tempDir, 'outside.txt');
			fsSync.writeFileSync(outside, 'keep me');
		});

		it('leaves a symlink planted at the old fixed temp name alone', async () => {
			// steno's temp name was `.<file>.tmp`
			const planted = path.join(tempDir, '.test.json.tmp');
			fsSync.symlinkSync(outside, planted);

			await fileOps.writeJson(testFilePath, { a: 1 });
			await fileOps.modifyJson(testFilePath, () => ({ a: 2 }));

			expect(fsSync.readFileSync(outside, 'utf-8')).toBe('keep me');
			expect(fsSync.lstatSync(planted).isSymbolicLink()).toBe(true);
			expect(JSON.parse(fsSync.readFileSync(testFilePath, 'utf-8'))).toEqual({
				a: 2
			});
		});

		it('refuses to write when the file itself is a symlink', async () => {
			fsSync.symlinkSync(outside, testFilePath);

			await expect(fileOps.writeJson(testFilePath, { a: 1 })).rejects.toThrow(
				/symlink/
			);
			await expect(
				fileOps.modifyJson(testFilePath, () => ({ a: 1 }))
			).rejects.toThrow(/symlink/);

			expect(fsSync.readFileSync(outside, 'utf-8')).toBe('keep me');
			expect(fsSync.lstatSync(testFilePath).isSymbolicLink()).toBe(true);
			expect(
				fsSync.readdirSync(tempDir).filter((f) => f.includes('.tmp'))
			).toHaveLength(0);
		});
	});

	describe('rename into place', () => {
		const tempFiles = () =>
			fsSync.readdirSync(tempDir).filter((f) => f.endsWith('.tmp'));

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('retries a rename Windows refuses while the file is open', async () => {
			const rename = fs.rename;
			vi.spyOn(fs, 'rename').mockImplementationOnce(() =>
				Promise.reject(Object.assign(new Error('busy'), { code: 'EPERM' }))
			);
			vi.mocked(fs.rename).mockImplementation(rename);

			await fileOps.writeJson(testFilePath, { a: 1 });

			expect(JSON.parse(fsSync.readFileSync(testFilePath, 'utf-8'))).toEqual({
				a: 1
			});
			expect(tempFiles()).toHaveLength(0);
		});

		it('removes the temp file when the rename fails', async () => {
			vi.spyOn(fs, 'rename').mockRejectedValue(
				Object.assign(new Error('nope'), { code: 'EXDEV' })
			);

			await expect(fileOps.writeJson(testFilePath, { a: 1 })).rejects.toThrow(
				'nope'
			);
			expect(tempFiles()).toHaveLength(0);
		});
	});

	describe('lock file left by the legacy writer', () => {
		// The legacy scripts take `<file>.lock` as a plain file; tm-core's lock is a
		// directory at the same path. A crashed legacy write leaves the file behind.
		const leaveStaleLockFile = () => {
			const lockPath = `${testFilePath}.lock`;
			fsSync.writeFileSync(lockPath, '{"pid":1,"timestamp":0}');
			const old = new Date(Date.now() - 60_000);
			fsSync.utimesSync(lockPath, old, old);
			return lockPath;
		};

		it('modifyJson takes over a stale lock file', async () => {
			await fs.writeFile(testFilePath, JSON.stringify({ count: 0 }));
			const lockPath = leaveStaleLockFile();

			await fileOps.modifyJson(testFilePath, (d: { count: number }) => ({
				count: d.count + 1
			}));

			expect(JSON.parse(await fs.readFile(testFilePath, 'utf-8'))).toEqual({
				count: 1
			});
			expect(fsSync.existsSync(lockPath)).toBe(false);
		});

		it('writeJson takes over a stale lock file', async () => {
			await fs.writeFile(testFilePath, '{}');
			const lockPath = leaveStaleLockFile();

			await fileOps.writeJson(testFilePath, { ok: true });

			expect(JSON.parse(await fs.readFile(testFilePath, 'utf-8'))).toEqual({
				ok: true
			});
			expect(fsSync.existsSync(lockPath)).toBe(false);
		});

		it('reports why a stale lock file could not be moved aside', async () => {
			await fs.writeFile(testFilePath, '{}');
			const lockPath = leaveStaleLockFile();
			const rename = fs.rename;
			vi.spyOn(fs, 'rename').mockImplementation((from, to) =>
				from === lockPath
					? Promise.reject(
							Object.assign(new Error('permission denied'), { code: 'EACCES' })
						)
					: rename(from, to)
			);

			try {
				await expect(
					fileOps.writeJson(testFilePath, { ok: true })
				).rejects.toMatchObject({ code: 'EACCES' });
			} finally {
				vi.restoreAllMocks();
			}
		});
	});
});
