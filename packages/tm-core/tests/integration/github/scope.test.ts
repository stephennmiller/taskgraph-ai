/**
 * @fileoverview Integration tests for which tags and task ids a push covers:
 * the active-tag default, allTags, and comma-separated id lists.
 * Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory fake.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { FakeGitHub, REPO, makeTask } from './fake-github.js';

describe('GitHub push - tag and id scope', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: FakeGitHub;

	/** Two tags: master has tasks 1 and 2, feature has task 3 */
	async function setup(getActiveTag?: () => string) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-scope-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		const storage = new FileStorage(projectDir);
		await storage.saveTasks([makeTask('1'), makeTask('2')], 'master');
		await storage.saveTasks([makeTask('3')], 'feature');
		tmCore = await createTmCore({ projectPath: projectDir });
		github = new FakeGitHub();
		const domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			getActiveTag,
			now: () => new Date('2026-01-01T00:00:00.000Z')
		});
		domain.setTasksDomain(tmCore.tasks);
		return domain;
	}

	const titles = () => github.issues.map((i) => i.title);

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('defaults to the active tag', async () => {
		const domain = await setup(() => 'feature');

		await domain.push({ repo: REPO, delayMs: 0 });

		expect(titles()).toEqual(['[3] Task 3']);
	});

	it('lets an explicit tag win over the active tag', async () => {
		const domain = await setup(() => 'feature');

		await domain.push({ repo: REPO, tag: 'master', delayMs: 0 });

		expect(titles()).toEqual(['[1] Task 1', '[2] Task 2']);
	});

	it('pushes every tag when allTags is set', async () => {
		const domain = await setup(() => 'feature');

		await domain.push({ repo: REPO, allTags: true, delayMs: 0 });

		expect(titles().sort()).toEqual(['[1] Task 1', '[2] Task 2', '[3] Task 3']);
	});

	it('pushes every tag when no active tag is known', async () => {
		const domain = await setup();

		await domain.push({ repo: REPO, delayMs: 0 });

		expect(titles()).toHaveLength(3);
	});

	it('rejects tag together with allTags', async () => {
		const domain = await setup(() => 'master');

		await expect(
			domain.planPush({ repo: REPO, tag: 'master', allTags: true })
		).rejects.toThrow('either tag or allTags');
	});

	it('accepts a comma-separated list of task ids', async () => {
		const domain = await setup(() => 'master');

		await domain.push({ repo: REPO, taskIds: '1, 2', delayMs: 0 });

		expect(titles()).toEqual(['[1] Task 1', '[2] Task 2']);
	});

	it('rejects a malformed task id list', async () => {
		const domain = await setup(() => 'master');

		await expect(
			domain.planPush({ repo: REPO, taskIds: '1,abc' })
		).rejects.toThrow('abc');
	});
});
