/**
 * @fileoverview The dependency views (`graph`, `why`, `dependency_analysis`)
 * against a real tasks.json: real FileStorage + TasksDomain on a temp dir,
 * nothing mocked.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import {
	createSubtask,
	createTask
} from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('dependency views', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup(byTag: Record<string, Task[]>) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-dep-views-'));
		fs.mkdirSync(path.join(projectDir, '.taskgraph', 'tasks'), {
			recursive: true
		});
		fs.writeFileSync(
			path.join(projectDir, '.taskgraph', 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		for (const [tag, tasks] of Object.entries(byTag)) {
			await seedTasks(new FileStorage(projectDir), tasks, tag);
		}
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	const project = () => ({
		master: [
			createTask({ id: 1, title: 'Set up the database' }),
			createTask({
				id: 2,
				title: 'Build the login API',
				dependencies: ['1'],
				subtasks: [
					createSubtask({
						id: 1,
						title: 'Write the auth schema',
						parentId: '2'
					})
				]
			})
		],
		feature: [createTask({ id: 1, title: 'Other work' })]
	});

	it('rejects a tag the project does not have instead of reading it as empty', async () => {
		await setup(project());

		await expect(
			tmCore.tasks.analyzeDependencies({ tag: 'nope' })
		).rejects.toThrow('Tag "nope" not found');
		await expect(
			tmCore.tasks.getDependencyTree({ tag: 'nope' })
		).rejects.toThrow('Tag "nope" not found');
		await expect(
			tmCore.tasks.explainBlockers('1', { tag: 'nope' })
		).rejects.toThrow('Tag "nope" not found');
	});

	it('reads a tag the project has', async () => {
		await setup(project());

		const analysis = await tmCore.tasks.analyzeDependencies({ tag: 'feature' });

		expect(analysis.criticalPath).toEqual(['1']);
	});

	it('explains a subtask through its parent', async () => {
		await setup(project());

		const explanation = await tmCore.tasks.explainBlockers('2.1');

		expect(explanation.blocked).toBe(true);
		expect(explanation.blockers[0]).toMatchObject({
			id: '2',
			parentOf: '2.1',
			blockers: [{ id: '1', kind: 'ready' }]
		});
	});
});
