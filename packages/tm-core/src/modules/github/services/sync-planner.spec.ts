import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import type { GitHubLink, RemoteIssue, SyncTask } from '../types.js';
import { hashIssue, markerFor, renderIssue } from './issue-renderer.js';
import { getLink, planSync } from './sync-planner.js';

const REPO = 'acme/app';

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		title: `Task ${id}`,
		description: 'desc',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		details: '',
		testStrategy: '',
		subtasks: [],
		...overrides
	};
}

/** A task already pushed: its link hash matches the current rendering */
function syncedTask(
	id: string,
	number: number,
	overrides: Partial<Task> = {}
): SyncTask {
	const task = makeTask(id, overrides);
	const link: GitHubLink = {
		repo: REPO,
		issueNumber: number,
		url: `https://github.com/${REPO}/issues/${number}`,
		syncedAt: '2026-01-01T00:00:00.000Z',
		lastPushedStatus: task.status,
		bodyHash: hashIssue(renderIssue(task, { tag: 'master' }))
	};
	return { tag: 'master', task: { ...task, metadata: { github: link } } };
}

function remoteIssue(
	number: number,
	body: string,
	overrides: Partial<RemoteIssue> = {}
): RemoteIssue {
	return {
		number,
		url: `https://github.com/${REPO}/issues/${number}`,
		title: 't',
		body,
		labels: ['taskgraph'],
		state: 'open',
		assignees: [],
		...overrides
	};
}

const plan = (
	tasks: SyncTask[],
	remote: RemoteIssue[] = [],
	extra: Partial<Parameters<typeof planSync>[0]> = {}
) => planSync({ repo: REPO, tasks, remote, ...extra });

describe('getLink', () => {
	it('ignores links that point at another repo', () => {
		const { task } = syncedTask('1', 5);

		expect(getLink(task, REPO)?.issueNumber).toBe(5);
		expect(getLink(task, 'other/repo')).toBeUndefined();
	});
});

describe('planSync', () => {
	it('creates an issue for a task with no link and no marker match', () => {
		const result = plan([{ tag: 'master', task: makeTask('1') }]);

		expect(result.steps).toEqual([
			expect.objectContaining({ action: 'create', taskId: '1', tag: 'master' })
		]);
	});

	it('skips a linked task whose rendering is unchanged', () => {
		const result = plan([syncedTask('1', 5)]);

		expect(result.steps[0]).toMatchObject({ action: 'skip', issueNumber: 5 });
	});

	it('updates a linked task whose rendering changed', () => {
		const synced = syncedTask('1', 5);
		synced.task.title = 'Renamed';

		const result = plan([synced]);

		expect(result.steps[0]).toMatchObject({ action: 'update', issueNumber: 5 });
	});

	it('recovers a lost link from the hidden marker instead of creating a duplicate', () => {
		const result = plan(
			[{ tag: 'master', task: makeTask('1') }],
			[remoteIssue(9, markerFor('master', '1'))]
		);

		expect(result.steps[0]).toMatchObject({
			action: 'update',
			issueNumber: 9,
			recovered: true
		});
	});

	it('keys links by tag, so the same id in two tags stays separate', () => {
		const result = plan(
			[
				{ tag: 'a', task: makeTask('1') },
				{ tag: 'b', task: makeTask('1') }
			],
			[remoteIssue(9, markerFor('a', '1'))]
		);

		expect(result.steps.map((s) => [s.tag, s.action])).toEqual([
			['a', 'update'],
			['b', 'create']
		]);
	});

	it('updates a dependent when the task it depends on is about to be created', () => {
		const dependent = syncedTask('2', 6, { dependencies: ['1'] });

		const result = plan([{ tag: 'master', task: makeTask('1') }, dependent]);

		expect(result.steps.map((s) => s.action)).toEqual(['create', 'update']);
	});

	it('reports issues whose task was deleted as orphans', () => {
		const result = plan(
			[syncedTask('1', 5)],
			[
				remoteIssue(5, markerFor('master', '1')),
				remoteIssue(7, markerFor('master', '2'))
			]
		);

		expect(result.orphans).toEqual([
			expect.objectContaining({ issueNumber: 7, tag: 'master', taskId: '2' })
		]);
		expect(result.steps.some((s) => s.action === 'close')).toBe(false);
	});

	it('adds close steps for orphans when closeOrphans is set', () => {
		const result = plan([], [remoteIssue(7, markerFor('master', '2'))], {
			closeOrphans: true
		});

		expect(result.steps).toEqual([
			expect.objectContaining({ action: 'close', issueNumber: 7 })
		]);
	});

	it('ignores closed issues and other tags outside the pushed scope', () => {
		const result = plan(
			[],
			[
				remoteIssue(7, markerFor('master', '2'), { state: 'closed' }),
				remoteIssue(8, markerFor('other', '1'))
			],
			{ scopeTags: ['master'] }
		);

		expect(result.orphans).toEqual([]);
	});
});
