import { describe, expect, it } from 'vitest';
import type { Task, TaskStatus } from '../../../common/types/index.js';
import type { GitHubLink, RemoteIssue, SyncTask } from '../types.js';
import { planPull } from './pull-planner.js';

const REPO = 'acme/app';

function linked(
	id: string,
	status: TaskStatus,
	lastPushedStatus: TaskStatus,
	overrides: Partial<GitHubLink> = {}
): SyncTask {
	const link: GitHubLink = {
		repo: REPO,
		issueNumber: Number(id),
		url: `https://github.com/${REPO}/issues/${id}`,
		syncedAt: '2026-01-01T00:00:00.000Z',
		lastPushedStatus,
		bodyHash: 'h',
		...overrides
	};
	const task = {
		id,
		title: `Task ${id}`,
		status,
		metadata: { github: link }
	} as unknown as Task;
	return { tag: 'master', task };
}

function issue(number: number, overrides: Partial<RemoteIssue> = {}) {
	return {
		number,
		url: `https://github.com/${REPO}/issues/${number}`,
		title: `[${number}] Task ${number}`,
		body: '',
		labels: ['taskgraph'],
		state: 'open',
		...overrides
	} as RemoteIssue;
}

const closed = (number: number) =>
	issue(number, { state: 'closed', stateReason: 'completed' });
const labelled = (number: number, status: string) =>
	issue(number, { labels: ['taskgraph', `taskgraph:status/${status}`] });

const planOne = (task: SyncTask, remote: RemoteIssue[]) =>
	planPull({ repo: REPO, tasks: [task], remote }).steps[0];

describe('planPull', () => {
	it('applies a change made on GitHub when the task did not change', () => {
		const step = planOne(linked('1', 'pending', 'pending'), [closed(1)]);

		expect(step).toMatchObject({
			action: 'apply',
			tag: 'master',
			taskId: '1',
			issueNumber: 1,
			from: 'pending',
			to: 'done'
		});
	});

	it('skips a task when GitHub did not change', () => {
		const step = planOne(linked('1', 'pending', 'pending'), [issue(1)]);

		expect(step.action).toBe('skip');
		expect(step.reason).toContain('unchanged');
	});

	it('leaves a local-only change for the next push', () => {
		const step = planOne(linked('1', 'in-progress', 'pending'), [issue(1)]);

		expect(step.action).toBe('skip');
		expect(step.reason).toContain('push');
	});

	it('records that both sides agree when both changed to the same status', () => {
		const step = planOne(linked('1', 'done', 'pending'), [closed(1)]);

		expect(step).toMatchObject({ action: 'sync', from: 'done', to: 'done' });
	});

	it('reports a conflict and leaves the task alone when both changed differently', () => {
		const step = planOne(linked('1', 'blocked', 'pending'), [closed(1)]);

		expect(step).toMatchObject({
			action: 'conflict',
			from: 'blocked',
			to: 'done'
		});
	});

	it('treats done and completed as the same status', () => {
		const step = planOne(linked('1', 'completed', 'done'), [closed(1)]);

		expect(step.action).toBe('skip');
	});

	it('uses the label that differs from the last synced status', () => {
		const both = issue(1, {
			labels: [
				'taskgraph',
				'taskgraph:status/pending',
				'taskgraph:status/review'
			]
		});

		const step = planOne(linked('1', 'pending', 'pending'), [both]);

		expect(step).toMatchObject({ action: 'apply', to: 'review' });
	});

	it('skips a task that has no link', () => {
		const task = linked('1', 'pending', 'pending');
		task.task.metadata = {};

		const step = planOne(task, [closed(1)]);

		expect(step.action).toBe('skip');
		expect(step.reason).toContain('push first');
	});

	it('skips a task linked to another repository', () => {
		const task = linked('1', 'pending', 'pending', { repo: 'other/repo' });

		const step = planOne(task, [closed(1)]);

		expect(step.action).toBe('skip');
		expect(step.reason).toContain('push first');
	});

	it('skips a task whose issue is not on GitHub', () => {
		const step = planOne(linked('1', 'pending', 'pending'), []);

		expect(step.action).toBe('skip');
		expect(step.reason).toContain('not found');
	});

	it('plans every task in order and reports the repo', () => {
		const plan = planPull({
			repo: REPO,
			tasks: [
				linked('1', 'pending', 'pending'),
				linked('2', 'pending', 'pending')
			],
			remote: [labelled(1, 'blocked'), issue(2)]
		});

		expect(plan.repo).toBe(REPO);
		expect(plan.steps.map((s) => [s.taskId, s.action])).toEqual([
			['1', 'apply'],
			['2', 'skip']
		]);
	});
});
