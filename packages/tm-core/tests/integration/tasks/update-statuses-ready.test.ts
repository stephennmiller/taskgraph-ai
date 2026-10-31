/**
 * @fileoverview `updateStatuses` to done also returns the tasks and subtasks
 * the write made ready (#879), which `set-status` prints.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

const task = (
	id: string,
	title: string,
	dependencies: string[] = [],
	extra: Record<string, unknown> = {}
) => ({
	id,
	title,
	description: '',
	status: 'pending',
	priority: 'medium',
	dependencies,
	details: '',
	testStrategy: '',
	subtasks: [],
	...extra
});

const sub = (id: string, title: string, dependencies: number[] = []) => ({
	id,
	title,
	description: '',
	status: 'pending',
	dependencies,
	details: ''
});

describe('updateStatuses returns what it made ready (#879)', () => {
	let projectDir: string;
	let tmCore: TmCore;

	beforeEach(async () => {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ready-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		fs.writeFileSync(
			path.join(tgDir, 'tasks', 'tasks.json'),
			JSON.stringify({
				master: {
					tasks: [
						task('1', 'Schema'),
						task('2', 'Auth'),
						task('3', 'Login page', ['2']),
						task('4', 'Billing', ['1', '2']),
						task('5', 'Logout', ['2']),
						task('6', 'Admin', ['4']),
						task('7', 'Docs', [], {
							status: 'in-progress',
							subtasks: [sub('1', 'Outline'), sub('2', 'Write', [1])]
						})
					],
					metadata: {}
				}
			})
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('lists only the tasks whose last open dependency was the one closed', async () => {
		const { updated, ready } = await tmCore.tasks.updateStatuses(['2'], 'done');

		expect(updated).toEqual([
			expect.objectContaining({ taskId: '2', newStatus: 'done' })
		]);
		// 4 still waits on 1
		expect(ready).toEqual([
			{ id: '3', title: 'Login page' },
			{ id: '5', title: 'Logout' }
		]);
	});

	it('lists the union once for several ids', async () => {
		const { ready } = await tmCore.tasks.updateStatuses(['1', '2'], 'done');

		expect(ready.map((t) => t.id).sort()).toEqual(['3', '4', '5']);
	});

	it('lists a sibling subtask a finished subtask unblocked', async () => {
		const { ready } = await tmCore.tasks.updateStatuses(['7.1'], 'done');

		expect(ready).toEqual([{ id: '7.2', title: 'Write' }]);
	});

	it('lists nothing for a status other than done', async () => {
		const { ready } = await tmCore.tasks.updateStatuses(['2'], 'cancelled');

		expect(ready).toEqual([]);
	});
});
