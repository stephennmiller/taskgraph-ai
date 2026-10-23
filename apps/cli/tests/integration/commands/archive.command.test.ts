/**
 * @fileoverview `taskgraph archive` on the built CLI: finished tasks move to
 * archive.json, a task that depended on one becomes ready, new tasks never
 * reuse an archived ID, `archive restore` brings one back, and renaming or
 * deleting a tag takes its archived tasks along.
 *
 * @integration
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

interface SavedTask {
	id: number | string;
	status: string;
}

const OLD = '2026-01-01T00:00:00.000Z';

describe('archive', () => {
	let testDir: string;
	let tasksPath: string;
	let archivePath: string;
	const binPath = getCliBinPath();

	const run = (args: string[]) =>
		spawnSync(process.execPath, [binPath, ...args], {
			cwd: testDir,
			encoding: 'utf8',
			timeout: 30000,
			env: {
				...process.env,
				TASKGRAPH_SKIP_AUTO_UPDATE: '1',
				FORCE_COLOR: '0'
			}
		});

	const ids = (tasks: SavedTask[] = []) => tasks.map((t) => String(t.id));
	const readJson = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
	const liveIds = (tag = 'master') => ids(readJson(tasksPath)[tag]?.tasks);
	const archivedIds = (tag = 'master') =>
		ids(readJson(archivePath)[tag]?.tasks);

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-archive-'));
		const init = run(['init', '--yes', '--no-aliases', '--no-git']);
		expect(init.status).toBe(0);
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		archivePath = path.join(testDir, '.taskgraph', 'tasks', 'archive.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({
							id: 1,
							title: 'Set up the database schema',
							status: 'done',
							updatedAt: OLD
						}),
						createTask({
							id: 2,
							title: 'Build the login API',
							dependencies: ['1']
						}),
						createTask({
							id: 3,
							title: 'Write the README',
							status: 'done',
							updatedAt: new Date().toISOString()
						})
					]
				})
			)
		);
		// Starting the built CLI for init can take over 15s on a busy machine
	}, 60000);

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('lists what would move on a dry run and changes nothing', () => {
		const result = run(['archive', '--dry-run']);

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			'Would archive 1 task done or cancelled 30+ days ago'
		);
		expect(result.stdout).toContain('Set up the database schema');
		expect(liveIds()).toEqual(['1', '2', '3']);
		expect(fs.existsSync(archivePath)).toBe(false);
	});

	it('moves old finished tasks out, keeps their IDs and counts them as done', () => {
		const archived = run(['archive']);

		expect(archived.status, archived.stderr).toBe(0);
		expect(archived.stdout.trim()).toBe(
			'✓ Archived 1 task done or cancelled 30+ days ago: 1'
		);
		expect(liveIds()).toEqual(['2', '3']);
		expect(archivedIds()).toEqual(['1']);

		// Task 2 depended on the archived task, so it is ready
		const next = run(['next', '--format', 'json']);
		expect(next.status, next.stderr).toBe(0);
		expect(JSON.parse(next.stdout).task.id).toBe('2');

		// The list summary agrees: ready, not waiting on dependencies
		const list = run(['list', '--format', 'text']);
		expect(list.status, list.stderr).toBe(0);
		expect(list.stdout).toMatch(/1 ready/);
		expect(list.stdout).not.toContain('waiting on dependencies');

		// A new task gets 4, not the free-looking 1
		const added = run(['add-task', '--title', 'New', '--description', 'New']);
		expect(added.status, added.stderr).toBe(0);
		expect(liveIds()).toEqual(['2', '3', '4']);
	});

	it('archives every finished task with --older-than 0, in JSON', () => {
		const result = run(['archive', '--older-than', '0', '--format', 'json']);

		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({
			olderThanDays: 0,
			dryRun: false,
			tasks: [
				{ id: '1', status: 'done' },
				{ id: '3', status: 'done' }
			]
		});
		expect(liveIds()).toEqual(['2']);
	});

	it('restores in the tag and format given after restore', () => {
		const data = readJson(tasksPath);
		data.feature = {
			tasks: [
				createTask({
					id: 7,
					title: 'Feature work',
					status: 'done',
					updatedAt: OLD
				})
			],
			metadata: {}
		};
		fs.writeFileSync(tasksPath, JSON.stringify(data));
		expect(run(['archive', '--tag', 'feature']).status).toBe(0);
		expect(archivedIds('feature')).toEqual(['7']);

		const restored = run([
			'archive',
			'restore',
			'7',
			'--tag',
			'feature',
			'--format',
			'json'
		]);

		expect(restored.status, restored.stderr).toBe(0);
		expect(JSON.parse(restored.stdout)).toMatchObject({
			restored: true,
			tag: 'feature'
		});
		expect(liveIds('feature')).toEqual(['7']);
	});

	it('restores a task by ID, and says so when it is not archived', () => {
		run(['archive']);

		const restored = run(['archive', 'restore', '1']);
		expect(restored.status, restored.stderr).toBe(0);
		expect(restored.stdout.trim()).toBe(
			'✓ Restored task 1  Set up the database schema'
		);
		expect(liveIds()).toEqual(['1', '2', '3']);
		expect(archivedIds()).toEqual([]);

		const again = run(['archive', 'restore', '1']);
		expect(again.status).toBe(1);
		expect(again.stderr).toContain("Task 1 isn't archived in tag 'master'");
	});

	it('rejects a number of days that is not a whole number, with a hint', () => {
		const result = run(['archive', '--older-than', 'soon']);

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('"soon" isn\'t a number of days');
		expect(result.stderr).toContain('taskgraph archive --older-than 30');
	});

	it('moves archived tasks with a renamed tag and drops them with a deleted one', () => {
		const file = readJson(tasksPath);
		file.feature = {
			tasks: [
				createTask({ id: 1, title: 'Ship it', status: 'done', updatedAt: OLD })
			],
			metadata: { created: OLD, description: 'Feature work' }
		};
		fs.writeFileSync(tasksPath, JSON.stringify(file));
		const archived = run(['archive', '--tag', 'feature']);
		expect(archived.status, archived.stderr).toBe(0);
		expect(archivedIds('feature')).toEqual(['1']);

		expect(run(['tags', 'rename', 'feature', 'launch']).status).toBe(0);
		expect(readJson(archivePath).feature).toBeUndefined();
		expect(archivedIds('launch')).toEqual(['1']);

		expect(run(['tags', 'remove', 'launch', '--yes']).status).toBe(0);
		expect(readJson(archivePath).launch).toBeUndefined();
	});
});
