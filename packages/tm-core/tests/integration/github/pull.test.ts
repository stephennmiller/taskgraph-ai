/**
 * @fileoverview Integration tests for pulling issue status into tasks.
 * Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory fake.
 * Each test pushes first so tasks are linked, then edits the fake issues the
 * way a person would on github.com.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import type { GitHubLink } from '../../../src/modules/github/types.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { FakeGitHub, REPO, makeTask } from './fake-github.js';

describe('GitHub pull', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: FakeGitHub;
	let domain: GitHubDomain;

	/** master has tasks 1-3, all pushed; other has task 4, never pushed */
	async function setup() {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-pull-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		const storage = new FileStorage(projectDir);
		await storage.saveTasks(
			[makeTask('1'), makeTask('2'), makeTask('3')],
			'master'
		);
		await storage.saveTasks([makeTask('4')], 'other');
		tmCore = await createTmCore({ projectPath: projectDir });
		github = new FakeGitHub();
		domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			getActiveTag: () => 'master',
			now: () => new Date('2026-02-02T00:00:00.000Z')
		});
		domain.setTasksDomain(tmCore.tasks);
		await domain.push({ repo: REPO, tag: 'master', delayMs: 0 });
	}

	const readTask = async (id: string, tag = 'master') => {
		const tasks = (await new FileStorage(projectDir).loadTasks(tag)) as Task[];
		return tasks.find((t) => String(t.id) === id) as Task;
	};
	const linkOf = async (id: string) =>
		(await readTask(id)).metadata?.github as GitHubLink;
	const issue = (number: number) =>
		github.issues.find((i) => i.number === number) as FakeGitHub['issues'][0];
	const close = (number: number) => {
		issue(number).state = 'closed';
		issue(number).stateReason = 'completed';
	};
	const setStatusLabel = (number: number, status: string) => {
		issue(number).labels = [
			...issue(number).labels.filter((l) => !l.startsWith('taskgraph:status/')),
			`taskgraph:status/${status}`
		];
	};

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('sets a task to done when its issue was closed', async () => {
		await setup();
		close(1);

		const result = await domain.pull({ repo: REPO });

		expect(result).toMatchObject({ dryRun: false, applied: 1 });
		expect((await readTask('1')).status).toBe('done');
		expect((await linkOf('1')).lastPushedStatus).toBe('done');
		expect((await readTask('2')).status).toBe('pending');
	});

	it('follows a status label changed on GitHub', async () => {
		await setup();
		setStatusLabel(2, 'in-progress');

		await domain.pull({ repo: REPO });

		expect((await readTask('2')).status).toBe('in-progress');
	});

	it('sets a task to cancelled when its issue was closed as not planned', async () => {
		await setup();
		issue(3).state = 'closed';
		issue(3).stateReason = 'not_planned';

		await domain.pull({ repo: REPO });

		expect((await readTask('3')).status).toBe('cancelled');
	});

	it('makes a task pending again when its closed issue is reopened', async () => {
		await setup();
		await tmCore.tasks.updateStatus('1', 'done', 'master');
		await domain.push({ repo: REPO, tag: 'master', delayMs: 0 });
		issue(1).state = 'open';
		issue(1).stateReason = undefined;

		await domain.pull({ repo: REPO });

		expect((await readTask('1')).status).toBe('pending');
	});

	it('keeps the local status and reports a conflict when both sides changed', async () => {
		await setup();
		await tmCore.tasks.updateStatus('3', 'blocked', 'master');
		close(3);

		const result = await domain.pull({ repo: REPO });

		expect(result).toMatchObject({ applied: 0, conflicts: 1 });
		expect((await readTask('3')).status).toBe('blocked');
		expect((await linkOf('3')).lastPushedStatus).toBe('pending');
	});

	it('leaves a local-only change alone', async () => {
		await setup();
		await tmCore.tasks.updateStatus('2', 'review', 'master');

		const result = await domain.pull({ repo: REPO });

		expect(result).toMatchObject({ applied: 0, conflicts: 0 });
		expect((await readTask('2')).status).toBe('review');
	});

	it('records that both sides agree when they changed to the same status', async () => {
		await setup();
		await tmCore.tasks.updateStatus('1', 'done', 'master');
		close(1);

		const result = await domain.pull({ repo: REPO });

		expect(result).toMatchObject({ applied: 0, synced: 1 });
		expect((await linkOf('1')).lastPushedStatus).toBe('done');
	});

	it('writes nothing on a dry run but still reports what would change', async () => {
		await setup();
		close(1);

		const result = await domain.pull({ repo: REPO, dryRun: true });

		expect(result).toMatchObject({ dryRun: true, applied: 1 });
		expect((await readTask('1')).status).toBe('pending');
		expect((await linkOf('1')).lastPushedStatus).toBe('pending');
	});

	it('pulls only the selected task ids', async () => {
		await setup();
		close(1);
		close(2);

		await domain.pull({ repo: REPO, taskIds: '1' });

		expect((await readTask('1')).status).toBe('done');
		expect((await readTask('2')).status).toBe('pending');
	});

	it('defaults to the active tag, skips unlinked tasks and supports allTags', async () => {
		await setup();

		const active = await domain.planPull({ repo: REPO });
		const all = await domain.planPull({ repo: REPO, allTags: true });

		expect(active.steps.map((s) => s.tag)).toEqual([
			'master',
			'master',
			'master'
		]);
		const unlinked = all.steps.find((s) => s.taskId === '4');
		expect(unlinked).toMatchObject({ action: 'skip', tag: 'other' });
		expect(unlinked?.reason).toContain('push first');
	});

	it('leaves the next push with nothing to create after a pull', async () => {
		await setup();
		close(1);
		await domain.pull({ repo: REPO });

		const plan = await domain.planPush({ repo: REPO, tag: 'master' });

		expect(plan.steps.find((s) => s.taskId === '1')?.action).not.toBe('create');
	});

	it('rejects tag together with allTags', async () => {
		await setup();

		await expect(
			domain.planPull({ repo: REPO, tag: 'master', allTags: true })
		).rejects.toThrow('either tag or allTags');
	});
});
