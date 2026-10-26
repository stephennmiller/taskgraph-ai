/**
 * @fileoverview Integration tests for importing existing GitHub issues as
 * tasks. Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory
 * fake holding hand-written issues (no taskgraph label, no marker).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import type {
	GitHubLink,
	RemoteIssue
} from '../../../src/modules/github/types.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { archivePathFor } from '../../../src/modules/tasks/utils/archive.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { FakeGitHub, REPO, makeTask } from './fake-github.js';
import { seedTasks } from '../seed-tasks.js';

const handWritten = (
	number: number,
	overrides: Partial<RemoteIssue> = {}
): RemoteIssue => ({
	number,
	url: `https://github.com/${REPO}/issues/${number}`,
	title: `Issue ${number}`,
	body: `Body of ${number}`,
	labels: [],
	state: 'open',
	...overrides
});

describe('GitHub import', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: FakeGitHub;
	let domain: GitHubDomain;

	async function setup(tasks: Task[] = [], archivedHighestId = 0) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-import-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		await seedTasks(new FileStorage(projectDir), tasks, 'master');
		if (archivedHighestId > 0) {
			fs.writeFileSync(
				archivePathFor(path.join(tgDir, 'tasks', 'tasks.json')),
				JSON.stringify({
					master: { tasks: [], metadata: { highestId: archivedHighestId } }
				})
			);
		}
		tmCore = await createTmCore({ projectPath: projectDir });
		github = new FakeGitHub();
		github.issues = [
			handWritten(40, { labels: ['bug'] }),
			handWritten(41),
			handWritten(42, { state: 'closed', stateReason: 'completed' })
		];
		domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			getActiveTag: () => 'master',
			now: () => new Date('2026-02-02T00:00:00.000Z')
		});
		domain.setTasksDomain(tmCore.tasks);
	}

	const readTasks = async () =>
		(await new FileStorage(projectDir).loadTasks('master')) as Task[];
	const taskFor = async (issueNumber: number) =>
		(await readTasks()).find(
			(t) => (t.metadata?.github as GitHubLink)?.issueNumber === issueNumber
		) as Task;
	const issue = (number: number) =>
		github.issues.find((i) => i.number === number) as RemoteIssue;

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('creates one linked task per open issue, and adds nothing when run again', async () => {
		await setup([makeTask('1')]);

		const result = await domain.import({ repo: REPO });

		expect(result).toMatchObject({ created: 2, linked: 0, skipped: 0 });
		expect(result.steps.map((s) => s.taskId)).toEqual(['2', '3']);
		const task = await taskFor(40);
		expect(task).toMatchObject({
			id: '2',
			title: 'Issue 40 (#40)',
			status: 'pending'
		});
		expect(task.details).toContain('Body of 40');
		expect(task.metadata?.github).toMatchObject({
			repo: REPO,
			issueNumber: 40,
			lastPushedStatus: 'pending',
			imported: true
		});
		expect(await taskFor(42)).toBeUndefined();

		const again = await domain.import({ repo: REPO });

		expect(again).toMatchObject({ created: 0, linked: 0, skipped: 2 });
		expect(await readTasks()).toHaveLength(3);
	});

	it('links an unlinked task whose title ends in (#<n>) instead of adding one', async () => {
		await setup([makeTask('7', { title: 'Fix the thing (#41)' })]);

		const result = await domain.import({ repo: REPO });

		expect(result).toMatchObject({ created: 1, linked: 1 });
		expect((await taskFor(41)).id).toBe('7');
		expect(await readTasks()).toHaveLength(2);
	});

	it('imports only issues with the label, and skips issues push wrote', async () => {
		await setup();
		github.issues.push(
			handWritten(43, {
				labels: ['bug', 'taskgraph'],
				body: '<!-- taskgraph:v1 tag=master id=9 -->\n\nPushed'
			})
		);

		const result = await domain.import({ repo: REPO, label: 'bug' });

		expect(result).toMatchObject({ created: 1, skipped: 1 });
		expect(result.steps[0].issueNumber).toBe(40);
	});

	it('writes nothing on a dry run', async () => {
		await setup();

		const result = await domain.import({ repo: REPO, dryRun: true });

		expect(result).toMatchObject({ dryRun: true, created: 2 });
		expect(await readTasks()).toHaveLength(0);
	});

	it('never reuses an archived task ID', async () => {
		await setup([makeTask('1')], 5);

		await domain.import({ repo: REPO });

		expect((await readTasks()).map((t) => t.id)).toEqual(['1', '6', '7']);
	});

	it('pull marks a task done when its imported issue closes, even after local progress', async () => {
		await setup([makeTask('1', { title: 'Work (#41)' })]);
		await domain.import({ repo: REPO });
		await tmCore.tasks.updateStatus('1', 'in-progress', 'master');
		issue(41).state = 'closed';
		issue(41).stateReason = 'completed';

		const result = await domain.pull({ repo: REPO });

		expect(result).toMatchObject({ applied: 1, conflicts: 0 });
		expect((await taskFor(41)).status).toBe('done');
		expect((await taskFor(40)).status).toBe('pending');
		expect(issue(41).body).toBe('Body of 41');
	});

	it('pull leaves an open imported issue alone and reopens the task with the issue', async () => {
		await setup([makeTask('1', { title: 'Work (#41)' })]);
		await domain.import({ repo: REPO });
		await tmCore.tasks.updateStatus('1', 'review', 'master');

		expect((await domain.pull({ repo: REPO })).applied).toBe(0);
		expect((await taskFor(41)).status).toBe('review');

		issue(41).state = 'closed';
		await domain.pull({ repo: REPO });
		issue(41).state = 'open';
		await domain.pull({ repo: REPO });

		expect((await taskFor(41)).status).toBe('pending');
	});

	it('pull cancels the task when its imported issue closes as not planned', async () => {
		await setup();
		await domain.import({ repo: REPO });
		issue(40).state = 'closed';
		issue(40).stateReason = 'not_planned';

		await domain.pull({ repo: REPO });

		expect((await taskFor(40)).status).toBe('cancelled');
	});

	it('push leaves imported issues untouched', async () => {
		await setup();
		await domain.import({ repo: REPO });
		const before = JSON.stringify(github.issues);

		const result = await domain.push({ repo: REPO, delayMs: 0 });

		expect(result).toMatchObject({ created: 0, updated: 0, skipped: 2 });
		expect(JSON.stringify(github.issues)).toBe(before);
	});
});
