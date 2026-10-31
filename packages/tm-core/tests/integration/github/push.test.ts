/**
 * @fileoverview Integration tests for the one-way GitHub push.
 * Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory fake.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import type {
	CreateIssueInput,
	GitHubClient,
	UpdateIssueInput
} from '../../../src/modules/github/adapters/github-client.interface.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import type {
	RemoteIssue,
	RepoInfo
} from '../../../src/modules/github/types.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

const REPO = 'acme/app';
const VIEWER = 'octocat';

class InMemoryGitHub implements GitHubClient {
	issues: RemoteIssue[] = [];
	writes = 0;
	/** Throw on the Nth createIssue call (1-based) */
	failCreateOn?: number;
	/** Runs while an issue is being created, as another session would */
	duringCreate?: () => Promise<unknown>;
	private creates = 0;

	async getRepo(): Promise<RepoInfo> {
		return { fullName: REPO, url: `https://github.com/${REPO}` };
	}
	async getViewer(): Promise<string> {
		return VIEWER;
	}
	async listIssues(label: string): Promise<RemoteIssue[]> {
		return this.issues
			.filter((i) => i.labels.includes(label))
			.map((i) => ({ ...i }));
	}
	async createIssue(input: CreateIssueInput): Promise<RemoteIssue> {
		this.creates++;
		if (this.creates === this.failCreateOn) throw new Error('network down');
		await this.duringCreate?.();
		this.writes++;
		const number = this.issues.length + 1;
		const issue: RemoteIssue = {
			number,
			url: `https://github.com/${REPO}/issues/${number}`,
			state: 'open',
			author: VIEWER,
			...input
		};
		this.issues.push(issue);
		return { ...issue };
	}
	async updateIssue(
		number: number,
		input: UpdateIssueInput
	): Promise<RemoteIssue> {
		this.writes++;
		const issue = this.issues.find((i) => i.number === number);
		if (!issue) throw new Error(`no issue ${number}`);
		Object.assign(issue, input);
		return { ...issue };
	}
	async ensureLabels(): Promise<void> {
		this.writes++;
	}
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		title: `Task ${id}`,
		description: `Description ${id}`,
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...overrides
	};
}

describe('GitHub push - integration', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: InMemoryGitHub;
	let domain: GitHubDomain;

	const readTasks = () =>
		new FileStorage(projectDir).loadTasks('master') as Promise<Task[]>;

	async function setup(tasks: Task[]) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-github-push-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		await seedTasks(new FileStorage(projectDir), tasks, 'master');

		tmCore = await createTmCore({ projectPath: projectDir });
		github = new InMemoryGitHub();
		domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			now: () => new Date('2026-01-01T00:00:00.000Z')
		});
		domain.setTasksDomain(tmCore.tasks);
	}

	const push = (extra = {}) =>
		domain.push({ repo: REPO, tag: 'master', delayMs: 0, ...extra });

	beforeEach(() => {
		github = new InMemoryGitHub();
	});

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('creates issues, links them in metadata, and numbers dependencies', async () => {
		await setup([
			makeTask('1'),
			makeTask('2', { dependencies: ['1'] }),
			makeTask('3', { status: 'done' })
		]);

		const result = await push();
		const tasks = await readTasks();
		const link = (id: string) =>
			(tasks.find((t) => t.id === id)?.metadata as any).github;

		expect(result.created).toBe(3);
		expect(link('1')).toMatchObject({ repo: REPO, issueNumber: 1 });
		expect(link('2').issueNumber).toBe(2);
		expect(github.issues[1].body).toContain('Blocked by #1');
		expect(github.issues[2].state).toBe('closed');
		expect(github.issues[2].stateReason).toBe('completed');
	});

	it('makes zero writes on a second push with no changes', async () => {
		await setup([makeTask('1'), makeTask('2', { dependencies: ['1'] })]);
		await push();
		const writesAfterFirst = github.writes;

		const second = await push();

		expect(github.writes).toBe(writesAfterFirst);
		expect(second.skipped).toBe(2);
		expect(second.created + second.updated + second.closed).toBe(0);
	});

	it('updates only the issue whose task changed', async () => {
		await setup([makeTask('1'), makeTask('2')]);
		await push();
		await tmCore.tasks.updateStatus('2', 'in-progress', 'master');
		const before = github.writes;

		const result = await push();

		expect(result.updated).toBe(1);
		expect(github.writes).toBe(before + 2); // labels + one update
		expect(github.issues[1].labels).toContain('taskgraph:status/in-progress');
	});

	it('leaves no duplicates after a crash mid-run and keeps saved links', async () => {
		await setup([makeTask('1'), makeTask('2'), makeTask('3')]);
		github.failCreateOn = 3;

		await expect(push()).rejects.toThrow('network down');
		const afterCrash = await readTasks();
		expect(afterCrash.filter((t) => t.metadata?.github)).toHaveLength(2);
		expect(github.issues).toHaveLength(2);

		github.failCreateOn = undefined;
		const rerun = await push();

		expect(rerun.created).toBe(1);
		expect(github.issues).toHaveLength(3);
		expect(new Set(github.issues.map((i) => i.title)).size).toBe(3);
		expect((await readTasks()).every((t) => t.metadata?.github)).toBe(true);
	});

	it('recovers a lost link from the marker instead of duplicating', async () => {
		await setup([makeTask('1')]);
		await push();
		await tmCore.tasks.modifyTask('1', () => ({ metadata: {} }), 'master');

		const rerun = await push();

		expect(rerun.created).toBe(0);
		expect(github.issues).toHaveLength(1);
		expect(((await readTasks())[0].metadata as any).github.issueNumber).toBe(1);
	});

	it('leaves an issue opened by another account alone when relinking', async () => {
		await setup([makeTask('1')]);
		await push();
		await tmCore.tasks.modifyTask('1', () => ({ metadata: {} }), 'master');
		github.issues[0].author = 'someone-else';
		const before = { ...github.issues[0] };

		const rerun = await push();

		expect(rerun.created).toBe(1);
		expect(github.issues[0]).toEqual(before);
		expect(((await readTasks())[0].metadata as any).github.issueNumber).toBe(2);
	});

	it('still pushes, without relinking, when the signed-in account cannot be read', async () => {
		await setup([makeTask('1')]);
		await push();
		await tmCore.tasks.modifyTask('1', () => ({ metadata: {} }), 'master');
		github.getViewer = () => Promise.reject(new Error('403'));

		const rerun = await push();

		expect(rerun.created).toBe(1);
		expect(((await readTasks())[0].metadata as any).github.issueNumber).toBe(2);
	});

	it('keeps a claim made while the issue was being created (#655)', async () => {
		await setup([makeTask('1', { metadata: { source: 'prd' } })]);
		github.duringCreate = () =>
			tmCore.tasks.claimNext({ tag: 'master', claimant: 'session-b' });

		await push();

		const [task] = await readTasks();
		expect(task.status).toBe('in-progress');
		expect(task.metadata).toMatchObject({
			source: 'prd',
			claimedBy: 'session-b',
			github: { issueNumber: 1 }
		});
	});

	it('does not touch metadata keys that belong to the user', async () => {
		await setup([makeTask('1', { metadata: { jira: 'ABC-1' } })]);

		await push();

		expect(((await readTasks())[0].metadata as any).jira).toBe('ABC-1');
	});

	it('writes nothing on a dry run, neither to GitHub nor to tasks', async () => {
		await setup([makeTask('1'), makeTask('2')]);
		const tasksFile = path.join(
			projectDir,
			'.taskgraph',
			'tasks',
			'tasks.json'
		);
		const before = fs.readFileSync(tasksFile, 'utf8');

		const result = await push({ dryRun: true });

		expect(result.dryRun).toBe(true);
		expect(result.plan.steps.map((s) => s.action)).toEqual([
			'create',
			'create'
		]);
		expect(github.writes).toBe(0);
		expect(fs.readFileSync(tasksFile, 'utf8')).toBe(before);
	});

	it('reports orphans and closes them only with closeOrphans', async () => {
		await setup([makeTask('1'), makeTask('2')]);
		await push();
		await new FileStorage(projectDir).deleteTask('2', 'master');

		const report = await push();
		expect(report.orphans.map((o) => o.taskId)).toEqual(['2']);
		expect(github.issues[1].state).toBe('open');

		const closed = await push({ closeOrphans: true });
		expect(closed.closed).toBe(1);
		expect(github.issues[1].state).toBe('closed');
		expect(github.issues[1].stateReason).toBe('not_planned');
	});
});
