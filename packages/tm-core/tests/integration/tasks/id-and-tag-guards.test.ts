/**
 * @fileoverview IDs and tags a command must refuse, against a real
 * tasks.json: a removed tag's IDs (#1095), unusable move destinations
 * (#1096), dependencies on missing tasks (#1097) and a tag switch
 * TASKGRAPH_TAG overrides (#1098)
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { createTask } from '../../../src/testing/task-fixtures.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

describe('ID and tag guards', () => {
	let projectDir: string;
	let tmCore: TmCore;

	async function setup() {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-guards-'));
		const dir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(dir, 'config.json'),
			JSON.stringify({ models: {}, global: {} })
		);
		await seedTasks(
			new FileStorage(projectDir),
			[1, 2, 3].map((id) => createTask({ id, title: `Task ${id}` })),
			'master'
		);
		tmCore = await createTmCore({ projectPath: projectDir });
	}

	const ids = async (tag?: string) =>
		(await tmCore.tasks.list({ tag })).tasks.map((t) => String(t.id));

	afterEach(async () => {
		vi.unstubAllEnvs();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it("refuses a move onto a removed tag's name that would reuse its IDs (#1095)", async () => {
		await setup();
		await tmCore.tasks.copyTag('master', 'feat');
		await tmCore.tasks.deleteTag('feat');

		await expect(
			tmCore.tasks.moveToTag(['1'], 'master', 'feat')
		).rejects.toThrow('its tasks used IDs up to 3');

		expect(await ids('master')).toEqual(['1', '2', '3']);
		expect(await new FileStorage(projectDir).getAllTags()).toEqual(['master']);
	});

	it('says how to get the tasks under the name with new IDs (#1126)', async () => {
		await setup();
		await tmCore.tasks.copyTag('master', 'feat');
		await tmCore.tasks.deleteTag('feat');

		await expect(tmCore.tasks.copyTag('master', 'feat')).rejects.toMatchObject({
			message: expect.stringContaining('its tasks used IDs up to 3'),
			hint: expect.stringMatching(
				/taskgraph tags add feat.*taskgraph move --from <ids> --from-tag <tag> --to-tag feat/
			)
		});
	});

	it("numbers a move into a removed tag's recreated name above its IDs (#1095)", async () => {
		await setup();
		await tmCore.tasks.copyTag('master', 'feat');
		await tmCore.tasks.deleteTag('feat');
		await tmCore.tasks.createTag('feat');

		await tmCore.tasks.moveToTag(['1'], 'master', 'feat');

		expect(await ids('feat')).toEqual(['4']);
	});

	it.each(['0', '4.0', '99999999999999999999'])(
		'refuses to move a task to ID %s (#1096)',
		async (to) => {
			await setup();

			await expect(tmCore.tasks.move('3', to)).rejects.toMatchObject({
				message: `Can't move to ID "${to}"`,
				hint: expect.stringContaining('5.2')
			});

			expect(await ids()).toEqual(['1', '2', '3']);
		}
	);

	it.each(['77', '2.9'])(
		'refuses a new subtask that depends on missing %s (#1097)',
		async (dependencies) => {
			await setup();

			await expect(
				tmCore.tasks.addSubtask('1', { title: 'Sub', dependencies })
			).rejects.toThrow(`Task ${dependencies} not found`);

			expect((await tmCore.tasks.get('1')).task?.subtasks).toEqual([]);
		}
	);

	it('refuses tags use while TASKGRAPH_TAG names another tag, and says how to unset it (#1098)', async () => {
		vi.stubEnv('TASKGRAPH_TAG', 'pinned');
		await setup();
		await tmCore.tasks.createTag('pinned');
		await tmCore.tasks.createTag('other');

		await expect(tmCore.tasks.useTag('other')).rejects.toMatchObject({
			message: expect.stringContaining('TASKGRAPH_TAG sets the current tag'),
			hint: expect.stringContaining('Unset TASKGRAPH_TAG')
		});
		// Removing it would leave every command on a tag that's gone
		await expect(tmCore.tasks.deleteTag('pinned')).rejects.toThrow(
			`TASKGRAPH_TAG sets the current tag to "pinned", so it can't be removed`
		);
		await expect(tmCore.tasks.renameTag('pinned', 'p2')).rejects.toThrow(
			"so it can't be renamed"
		);
		// A tag the variable doesn't name is still free to go
		await tmCore.tasks.deleteTag('other');
		await expect(tmCore.tasks.useTag('pinned')).resolves.toMatchObject({
			currentTag: 'pinned'
		});
	});

	it('names TASKGRAPH_TAG when the tag it sets is missing (#1098)', async () => {
		vi.stubEnv('TASKGRAPH_TAG', 'gone');
		await setup();

		await expect(tmCore.tasks.list()).rejects.toMatchObject({
			message: `Active tag "gone" isn't in tasks.json`,
			hint: expect.stringContaining('Unset TASKGRAPH_TAG')
		});
	});
});
