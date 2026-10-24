/**
 * @fileoverview A tag tasks.json doesn't have, named with --tag or left
 * active in state.json, against a real tasks.json (#418)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';

describe('a missing tag', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup(activeTag?: string) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-missing-tag-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		if (activeTag) {
			fs.writeFileSync(
				path.join(dir, 'state.json'),
				JSON.stringify({ currentTag: activeTag })
			);
		}
		await new FileStorage(projectDir).saveTasks(
			[createTask({ id: 1, title: 'Set up the database' })],
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('is reported by name when a task read or write names it', async () => {
		await setup();

		await expect(tmCore.tasks.get('1', 'nosuch')).rejects.toThrow(
			'Tag "nosuch" not found'
		);
		await expect(
			tmCore.tasks.updateStatus('1', 'done', 'nosuch')
		).rejects.toThrow('Tag "nosuch" not found');
	});

	it('is reported as a stale active tag by list, next and get', async () => {
		await setup('gone');
		const stale = `Active tag "gone" isn't in tasks.json`;

		await expect(tmCore.tasks.list()).rejects.toThrow(stale);
		await expect(tmCore.tasks.getNext()).rejects.toThrow(stale);
		await expect(tmCore.tasks.get('1')).rejects.toThrow(stale);
	});

	it('is not created by a write when tasks.json has other tags only (#556)', async () => {
		await setup();
		const tasksPath = path.join(projectDir, '.taskgraph/tasks/tasks.json');
		const sprintOnly = {
			sprint: {
				tasks: [createTask({ id: 1, title: 'Set up the database' })],
				metadata: {}
			}
		};
		fs.writeFileSync(tasksPath, JSON.stringify(sprintOnly));

		await expect(tmCore.tasks.updateStatus('1', 'done')).rejects.toThrow(
			`Tag "master" isn't in tasks.json`
		);

		expect(JSON.parse(fs.readFileSync(tasksPath, 'utf-8'))).toEqual(sprintOnly);
	});

	it('gives prime an empty context that says so, not a failure', async () => {
		await setup('gone');

		const context = await tmCore.tasks.getPrimeContext();

		expect(context).toMatchObject({ tag: 'gone', tagMissing: true });
		expect(context.rules.length).toBeGreaterThan(0);
	});
});
