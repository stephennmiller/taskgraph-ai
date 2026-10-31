/**
 * @fileoverview Integration tests for task assignees and GitHub issue
 * assignees: push writes a local change, pull and import bring GitHub's back.
 * Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory fake.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import type { GitHubLink } from '../../../src/modules/github/types.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { FakeGitHub, REPO, makeTask } from './fake-github.js';
import { seedTasks } from '../seed-tasks.js';

describe('Task assignees', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: FakeGitHub;
	let domain: GitHubDomain;

	async function setup(tasks: Task[]) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-assign-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		await seedTasks(new FileStorage(projectDir), tasks, 'master');
		tmCore = await createTmCore({ projectPath: projectDir });
		github = new FakeGitHub();
		domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			getActiveTag: () => 'master'
		});
		domain.setTasksDomain(tmCore.tasks);
	}

	const push = () => domain.push({ repo: REPO, tag: 'master', delayMs: 0 });
	const readTask = async (id: string) => {
		const tasks = (await new FileStorage(projectDir).loadTasks(
			'master'
		)) as Task[];
		return tasks.find((t) => String(t.id) === id) as Task;
	};
	const issue = (number: number) =>
		github.issues.find((i) => i.number === number) as FakeGitHub['issues'][0];

	afterEach(async () => {
		vi.restoreAllMocks();
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('assigns a claimed task to the claimer, unless it has an assignee', async () => {
		await setup([
			makeTask('1', { assignee: 'alice', priority: 'high' }),
			makeTask('2')
		]);

		const first = await tmCore.tasks.claimNext({ assignee: 'Bob' });
		const second = await tmCore.tasks.claimNext({ assignee: 'Bob' });

		expect(first?.task.assignee).toBe('alice');
		expect(second?.task.assignee).toBe('bob');
		expect((await readTask('1')).assignee).toBe('alice');
		expect((await readTask('2')).assignee).toBe('bob');
	});

	it('creates the issue with the assignee and records it as the base', async () => {
		await setup([makeTask('1', { assignee: 'alice' }), makeTask('2')]);

		await push();

		expect(issue(1).assignees).toEqual(['alice']);
		expect(issue(2).assignees).toEqual([]);
		const link = (await readTask('1')).metadata?.github as GitHubLink;
		expect(link.assignee).toBe('alice');
	});

	it('pushes a local reassignment, and nothing more once it is written', async () => {
		await setup([makeTask('1', { assignee: 'alice' })]);
		await push();
		await tmCore.tasks.assign('1', '@Bob');
		const update = vi.spyOn(github, 'updateIssue');

		const result = await push();

		expect(result.updated).toBe(1);
		expect(update).toHaveBeenCalledWith(
			1,
			expect.objectContaining({ assignees: ['bob'] })
		);
		expect((await push()).updated).toBe(0);
	});

	it('leaves an assignee set on GitHub alone when the task has none', async () => {
		await setup([makeTask('1')]);
		await push();
		issue(1).assignees = ['carol'];
		await tmCore.tasks.modifyTask('1', () => ({ title: 'Renamed' }));

		await push();

		expect(issue(1).title).toBe('[1] Renamed');
		expect(issue(1).assignees).toEqual(['carol']);
	});

	it('pulls an assignee set on GitHub, and keeps a local one changed on both sides', async () => {
		await setup([makeTask('1'), makeTask('2', { assignee: 'alice' })]);
		await push();
		issue(1).assignees = ['carol'];
		issue(2).assignees = ['dave'];
		await tmCore.tasks.assign('2', 'erin');

		const result = await domain.pull({ repo: REPO });

		expect(result.assigned).toBe(1);
		expect((await readTask('1')).assignee).toBe('carol');
		expect((await readTask('2')).assignee).toBe('erin');
		// The pulled assignee is the base now, so a push has nothing to write for it
		const link = (await readTask('1')).metadata?.github as GitHubLink;
		expect(link.assignee).toBe('carol');
	});

	it('clears the task when its issue was unassigned', async () => {
		await setup([makeTask('1', { assignee: 'alice' })]);
		await push();
		issue(1).assignees = [];

		await domain.pull({ repo: REPO });

		expect((await readTask('1')).assignee).toBeUndefined();
	});

	it('counts but writes nothing in a dry run', async () => {
		await setup([makeTask('1')]);
		await push();
		issue(1).assignees = ['carol'];

		const result = await domain.pull({ repo: REPO, dryRun: true });

		expect(result.assigned).toBe(1);
		expect(result.plan.steps[0].assignTo).toBe('carol');
		expect((await readTask('1')).assignee).toBeUndefined();
	});

	it("gives an imported task the issue's first assignee", async () => {
		await setup([]);
		github.issues = [
			{
				number: 7,
				url: `https://github.com/${REPO}/issues/7`,
				title: 'Hand written',
				body: '',
				labels: [],
				assignees: ['frank', 'gina'],
				state: 'open'
			}
		];

		await domain.import({ repo: REPO });

		const [task] = (await new FileStorage(projectDir).loadTasks(
			'master'
		)) as Task[];
		expect(task.assignee).toBe('frank');
		expect((task.metadata?.github as GitHubLink).assignee).toBe('frank');
	});

	it('says who can be assigned when GitHub refuses the login', async () => {
		await setup([makeTask('1', { assignee: 'stranger' })]);
		vi.spyOn(github, 'createIssue').mockRejectedValue(
			new Error(
				'GitHub request POST repos/acme/app/issues failed (422): Validation Failed'
			)
		);

		await expect(push()).rejects.toMatchObject({
			hint: expect.stringContaining('collaborators on acme/app')
		});
	});
});
