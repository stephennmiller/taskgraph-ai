/**
 * @fileoverview Integration tests for pushing selected task ids and unlinking.
 * Real FileStorage + TasksDomain on a temp dir; GitHub is an in-memory fake.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Task } from '../../../src/common/types/index.js';
import type {
	CreateIssueInput,
	GitHubClient,
	UpdateIssueInput
} from '../../../src/modules/github/adapters/github-client.interface.js';
import { GitHubDomain } from '../../../src/modules/github/github-domain.js';
import type { RemoteIssue } from '../../../src/modules/github/types.js';
import { FileStorage } from '../../../src/modules/storage/adapters/file-storage/file-storage.js';
import { type TmCore, createTmCore } from '../../../src/tm-core.js';
import { seedTasks } from '../seed-tasks.js';

const REPO = 'acme/app';

class FakeGitHub implements GitHubClient {
	issues: RemoteIssue[] = [];
	async getRepo() {
		return { fullName: REPO, url: `https://github.com/${REPO}` };
	}
	async listIssues(label: string) {
		return this.issues.filter((i) => i.labels.includes(label));
	}
	async createIssue(input: CreateIssueInput) {
		const number = this.issues.length + 1;
		const issue: RemoteIssue = {
			number,
			url: `https://github.com/${REPO}/issues/${number}`,
			state: 'open',
			...input
		};
		this.issues.push(issue);
		return { ...issue };
	}
	async updateIssue(number: number, input: UpdateIssueInput) {
		const issue = this.issues.find((i) => i.number === number);
		if (!issue) throw new Error(`no issue ${number}`);
		Object.assign(issue, input);
		return { ...issue };
	}
	async ensureLabels() {}
}

const makeTask = (id: string, overrides: Partial<Task> = {}): Task => ({
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
});

describe('GitHub push - id selection and unlink', () => {
	let projectDir: string;
	let tmCore: TmCore;
	let github: FakeGitHub;
	let domain: GitHubDomain;

	const readTasks = (tag = 'master') =>
		new FileStorage(projectDir).loadTasks(tag) as Promise<Task[]>;

	async function setup(tasks: Task[], extraTags: Record<string, Task[]> = {}) {
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gh-select-'));
		const tgDir = path.join(projectDir, '.taskgraph');
		fs.mkdirSync(path.join(tgDir, 'tasks'), { recursive: true });
		fs.writeFileSync(
			path.join(tgDir, 'config.json'),
			JSON.stringify({ models: {} })
		);
		const storage = new FileStorage(projectDir);
		await seedTasks(storage, tasks, 'master');
		for (const [tag, list] of Object.entries(extraTags)) {
			await seedTasks(storage, list, tag);
		}
		tmCore = await createTmCore({ projectPath: projectDir });
		github = new FakeGitHub();
		domain = new GitHubDomain(projectDir, {
			clientFactory: () => github,
			now: () => new Date('2026-01-01T00:00:00.000Z')
		});
		domain.setTasksDomain(tmCore.tasks);
	}

	afterEach(async () => {
		await tmCore?.close();
		fs.rmSync(projectDir, { recursive: true, force: true });
	});

	it('pushes only the selected task ids', async () => {
		await setup([makeTask('1'), makeTask('2'), makeTask('3')]);

		const result = await domain.push({
			repo: REPO,
			tag: 'master',
			taskIds: ['1', '3'],
			delayMs: 0
		});

		expect(result.created).toBe(2);
		expect(github.issues.map((i) => i.title)).toEqual([
			'[1] Task 1',
			'[3] Task 3'
		]);
	});

	it('does not report unselected tasks as orphans', async () => {
		await setup([makeTask('1'), makeTask('2')]);
		await domain.push({ repo: REPO, tag: 'master', delayMs: 0 });

		const plan = await domain.planPush({
			repo: REPO,
			tag: 'master',
			taskIds: ['1'],
			closeOrphans: true
		});

		expect(plan.steps.map((s) => s.action)).toEqual(['skip']);
		expect(plan.orphans).toEqual([]);
	});

	it('rejects selected ids that match no task', async () => {
		await setup([makeTask('1')]);

		await expect(
			domain.planPush({ repo: REPO, tag: 'master', taskIds: ['1', '9'] })
		).rejects.toThrow('9');
	});

	it('unlink removes only the link and keeps other metadata keys', async () => {
		await setup([makeTask('1', { metadata: { owner: 'sam' } })]);
		await domain.push({ repo: REPO, tag: 'master', delayMs: 0 });

		const result = await domain.unlink('1', { tag: 'master' });

		const [task] = await readTasks();
		expect(result).toMatchObject({
			tag: 'master',
			taskId: '1',
			issueNumber: 1
		});
		expect(task.metadata).toEqual({ owner: 'sam' });
	});

	it('unlink fails for a task that is not linked', async () => {
		await setup([makeTask('1')]);

		await expect(domain.unlink('1', { tag: 'master' })).rejects.toThrow(
			'not linked'
		);
	});

	it('unlink fails for an unknown task id', async () => {
		await setup([makeTask('1')]);

		await expect(domain.unlink('7', { tag: 'master' })).rejects.toThrow(
			'not found'
		);
	});

	it('unlink without a tag refuses an id that is linked in several tags', async () => {
		await setup([makeTask('1')], { other: [makeTask('1')] });
		await domain.push({ repo: REPO, delayMs: 0 });

		await expect(domain.unlink('1')).rejects.toThrow('--tag');
	});
});
