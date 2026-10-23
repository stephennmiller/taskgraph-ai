import { describe, expect, it } from 'vitest';
import type { Task, TaskStatus } from '../../../common/types/index.js';
import type { RemoteIssue } from '../types.js';
import { renderIssue } from './issue-renderer.js';
import { sameStatus, statusFromIssue } from './issue-status.js';

const ALL_STATUSES: TaskStatus[] = [
	'pending',
	'in-progress',
	'done',
	'deferred',
	'cancelled',
	'blocked',
	'review'
];

function issue(overrides: Partial<RemoteIssue> = {}): RemoteIssue {
	return {
		number: 1,
		url: 'https://github.com/acme/app/issues/1',
		title: '[1] Task',
		body: '',
		labels: ['taskgraph'],
		state: 'open',
		...overrides
	};
}

describe('statusFromIssue', () => {
	it('maps a closed issue to done unless it was closed as not planned', () => {
		expect(
			statusFromIssue(issue({ state: 'closed', stateReason: 'completed' }))
		).toBe('done');
		expect(statusFromIssue(issue({ state: 'closed' }))).toBe('done');
		expect(
			statusFromIssue(issue({ state: 'closed', stateReason: 'not_planned' }))
		).toBe('cancelled');
	});

	it('ignores status labels on a closed issue', () => {
		const closed = issue({
			state: 'closed',
			labels: ['taskgraph', 'taskgraph:status/in-progress']
		});

		expect(statusFromIssue(closed)).toBe('done');
	});

	it('reads the status label of an open issue', () => {
		const open = issue({
			labels: ['taskgraph', 'taskgraph:status/blocked']
		});

		expect(statusFromIssue(open)).toBe('blocked');
	});

	it('treats an open issue without a status label as pending', () => {
		expect(statusFromIssue(issue())).toBe('pending');
	});

	it('ignores status labels that are not open statuses', () => {
		const odd = issue({
			labels: ['taskgraph', 'taskgraph:status/done', 'taskgraph:status/nope']
		});

		expect(statusFromIssue(odd)).toBe('pending');
	});

	it('prefers the label that differs from the last synced status', () => {
		const two = issue({
			labels: [
				'taskgraph',
				'taskgraph:status/in-progress',
				'taskgraph:status/review'
			]
		});

		expect(statusFromIssue(two, 'in-progress')).toBe('review');
		expect(statusFromIssue(two, 'review')).toBe('in-progress');
	});

	it.each(ALL_STATUSES)('round-trips %s through a rendered issue', (status) => {
		const task = { id: '1', title: 'T', status } as Task;
		const rendered = renderIssue(task, { tag: 'master' });
		const remote = issue({
			labels: rendered.labels,
			state: rendered.state,
			stateReason: rendered.stateReason
		});

		expect(sameStatus(statusFromIssue(remote), status)).toBe(true);
	});
});

describe('sameStatus', () => {
	it('treats done and the older completed, as a link saved before may hold, as the same', () => {
		expect(sameStatus('done', 'completed' as never)).toBe(true);
		expect(sameStatus('done', 'pending')).toBe(false);
		expect(sameStatus('in-progress', 'in-progress')).toBe(true);
	});
});
