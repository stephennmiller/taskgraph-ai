/**
 * @fileoverview Claims against a real tasks.json: two sessions claiming at
 * the same time must get different tasks, and setting a task back to pending
 * releases it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';

function createTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		title: `Task ${id}`,
		description: `Description for task ${id}`,
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...overrides
	};
}

describe('FileStorage claimNextTask', () => {
	let tempDir: string;

	/** Each session gets its own storage, as separate processes would */
	const session = () => new FileStorage(tempDir);

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskgraph-claim-'));
		fs.mkdirSync(path.join(tempDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it('gives two sessions claiming at once different tasks', async () => {
		await session().saveTasks([createTask('1'), createTask('2')]);

		const [first, second] = await Promise.all([
			session().claimNextTask('alice'),
			session().claimNextTask('bob')
		]);

		expect(first?.task.id).toBeDefined();
		expect(second?.task.id).toBeDefined();
		expect(first?.task.id).not.toBe(second?.task.id);

		const tasks = await session().loadTasks();
		expect(tasks.map((t) => t.status)).toEqual(['in-progress', 'in-progress']);
		expect(
			tasks
				.map((t) => t.metadata?.claimedBy)
				.sort((a, b) => String(a).localeCompare(String(b)))
		).toEqual(['alice', 'bob']);
	});

	it('hands out every ready task once and then reports nothing ready', async () => {
		await session().saveTasks([
			createTask('1'),
			createTask('2'),
			createTask('3')
		]);

		const claims = await Promise.all(
			['a', 'b', 'c', 'd', 'e'].map((who) => session().claimNextTask(who))
		);

		const claimed = claims.filter((claim) => claim !== null);
		expect(claimed.map((c) => String(c.task.id)).sort()).toEqual([
			'1',
			'2',
			'3'
		]);
		expect(claims.filter((claim) => claim === null)).toHaveLength(2);
	});

	it('claims by the same order as next', async () => {
		await session().saveTasks([
			createTask('1', { priority: 'low' }),
			createTask('2', { priority: 'high' }),
			createTask('3', { dependencies: ['2'] })
		]);

		const claim = await session().claimNextTask('alice');

		expect(claim?.task.id).toBe('2');
		expect(claim?.claimedBy).toBe('alice');
		expect(claim?.task.metadata).toMatchObject({
			claimedBy: 'alice',
			claimedAt: claim?.claimedAt
		});
	});

	it('claims a subtask of a task in progress and records the claim on it', async () => {
		await session().saveTasks([
			createTask('1', {
				status: 'in-progress',
				subtasks: [
					{
						id: 1,
						parentId: '1',
						title: 'Started',
						description: '',
						status: 'in-progress',
						priority: 'medium',
						dependencies: [],
						details: '',
						testStrategy: ''
					},
					{
						id: 2,
						parentId: '1',
						title: 'Not started',
						description: '',
						status: 'pending',
						priority: 'medium',
						dependencies: [],
						details: '',
						testStrategy: ''
					}
				]
			})
		]);

		const claim = await session().claimNextTask('alice');

		expect(claim?.task.id).toBe('1.2');
		const [task] = await session().loadTasks();
		expect(task.subtasks[1]).toMatchObject({
			status: 'in-progress',
			metadata: { claimedBy: 'alice' }
		});
	});

	it('keeps other metadata on the claimed task', async () => {
		await session().saveTasks([
			createTask('1', { metadata: { externalId: 'JIRA-1' } })
		]);

		await session().claimNextTask('alice');

		const [task] = await session().loadTasks();
		expect(task.metadata).toMatchObject({
			externalId: 'JIRA-1',
			claimedBy: 'alice'
		});
	});

	it('releases the claim when the task goes back to pending', async () => {
		await session().saveTasks([
			createTask('1', { metadata: { externalId: 'JIRA-1' } }),
			createTask('2')
		]);
		const storage = session();
		await storage.claimNextTask('alice');
		await storage.claimNextTask('alice');

		await storage.updateTaskStatus('1', 'pending');
		await storage.updateTaskStatus('2', 'pending');

		const [one, two] = await session().loadTasks();
		expect(one.status).toBe('pending');
		expect(one.metadata).toEqual({ externalId: 'JIRA-1' });
		expect(two.metadata).toBeUndefined();
		// Released, so the next claim can take it again
		expect((await session().claimNextTask('bob'))?.task.id).toBe('1');
	});

	it('keeps the claim when the task is finished', async () => {
		await session().saveTasks([createTask('1')]);
		await session().claimNextTask('alice');

		await session().updateTaskStatus('1', 'done');

		const [task] = await session().loadTasks();
		expect(task.metadata).toMatchObject({ claimedBy: 'alice' });
	});

	it('leaves the file untouched when nothing is ready', async () => {
		await session().saveTasks([createTask('1', { status: 'done' })]);
		const file = path.join(tempDir, '.taskgraph', 'tasks', 'tasks.json');
		const before = fs.readFileSync(file, 'utf8');

		const claim = await session().claimNextTask('alice');

		expect(claim).toBeNull();
		expect(fs.readFileSync(file, 'utf8')).toBe(before);
	});
});
