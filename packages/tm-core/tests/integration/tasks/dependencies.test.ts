/**
 * @fileoverview tasks.addDependency / removeDependency / validateDependencies
 * / fixDependencies against a real tasks.json: what they write, that a
 * refused change or a check writes nothing, the tag option, and archived
 * tasks counting as done.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('tasks dependency commands', () => {
	let projectDir: string;
	let tasksPath: string;
	let tmCore: TmCore;

	const task = (id: number, dependencies: unknown[] = [], extra = {}) => ({
		id,
		title: `Task ${id}`,
		description: '',
		status: 'pending',
		priority: 'medium',
		dependencies,
		...extra
	});
	const write = (data: unknown) =>
		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
	const read = () => JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-deps-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		tasksPath = path.join(tgDir, 'tasks', 'tasks.json');
		write({
			master: {
				tasks: [
					task(1),
					task(2, [1], {
						subtasks: [
							{ id: 1, title: 'S', status: 'pending', dependencies: [] }
						]
					}),
					task(3)
				],
				metadata: {}
			},
			other: { tasks: [task(1), task(2)], metadata: {} }
		});
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('adds and removes a dependency in the active tag', async () => {
		const added = await tmCore.tasks.addDependency('3', '2.1');

		expect(added).toMatchObject({ taskId: '3', tag: 'master', changed: true });
		expect(read().master.tasks[2].dependencies).toEqual(['2.1']);

		const removed = await tmCore.tasks.removeDependency('3', '2.1');

		expect(removed).toMatchObject({ removed: true, tag: 'master' });
		expect(read().master.tasks[2].dependencies).toEqual([]);
	});

	it('writes to the tag it is given, leaving the active tag alone', async () => {
		const before = read().master;

		await tmCore.tasks.addDependency('2', '1', { tag: 'other' });

		const after = read();
		expect(after.other.tasks[1].dependencies).toEqual(['1']);
		expect(after.master).toEqual(before);
	});

	it('writes nothing for a refused change', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(tmCore.tasks.addDependency('1', '2')).rejects.toThrow(
			'That would make a loop: task 2 already depends on task 1'
		);
		await expect(tmCore.tasks.addDependency('2', '99')).rejects.toThrow(
			'Task 99 not found'
		);
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('refuses a tag the project does not have', async () => {
		await expect(
			tmCore.tasks.addDependency('2', '1', { tag: 'nope' })
		).rejects.toThrow('Tag "nope" not found');
	});

	it('reads a missing master tag as empty and never writes it', async () => {
		write({ sprint: { tasks: [task(1), task(2)], metadata: {} } });
		const before = fs.readFileSync(tasksPath, 'utf8');

		await expect(tmCore.tasks.addDependency('2', '1')).rejects.toThrow(
			'Task 1 not found'
		);
		expect((await tmCore.tasks.validateDependencies()).taskCount).toBe(0);
		expect((await tmCore.tasks.fixDependencies()).changed).toBe(false);
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('validates without writing, and fixes in one write', async () => {
		const tasks = read();
		tasks.master.tasks[0].dependencies = [1, 99];
		tasks.master.tasks[2].dependencies = [2, 2];
		write(tasks);
		const before = fs.readFileSync(tasksPath, 'utf8');

		const check = await tmCore.tasks.validateDependencies();

		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
		expect(check).toMatchObject({
			valid: false,
			taskCount: 3,
			subtaskCount: 1,
			dependencyCount: 5,
			prdCoverage: null,
			tasksPath
		});
		expect(check.issues.map((i) => [i.type, i.taskId])).toEqual([
			['self', 1],
			['missing', 1]
		]);

		const fixed = await tmCore.tasks.fixDependencies();

		expect(fixed).toMatchObject({
			changed: true,
			remaining: [],
			tag: 'master',
			dependencyCount: 2,
			tasksPath
		});
		expect(fixed.fixes.map((f) => f.type)).toEqual([
			'duplicate',
			'self',
			'missing'
		]);
		expect(read().master.tasks.map((t: any) => t.dependencies)).toEqual([
			[],
			['1'],
			['2']
		]);
		expect((await tmCore.tasks.validateDependencies()).valid).toBe(true);
	});

	it('fix writes nothing when there is nothing to fix', async () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const fixed = await tmCore.tasks.fixDependencies();

		expect(fixed).toMatchObject({ fixes: [], changed: false });
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	});

	it('counts a dependency on an archived task as done', async () => {
		const tasks = read();
		tasks.master.tasks[2].dependencies = [7];
		write(tasks);
		fs.writeFileSync(
			path.join(path.dirname(tasksPath), 'archive.json'),
			JSON.stringify({
				master: {
					tasks: [{ ...task(7), status: 'done' }],
					metadata: { highestId: 7 }
				}
			})
		);

		expect((await tmCore.tasks.validateDependencies()).valid).toBe(true);
		await expect(tmCore.tasks.addDependency('1', '7')).rejects.toThrow(
			'Task 7 is archived, so it already counts as done'
		);
	});
});
