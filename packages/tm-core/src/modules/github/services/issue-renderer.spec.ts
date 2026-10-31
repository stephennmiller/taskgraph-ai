import { describe, expect, it } from 'vitest';
import type { Task } from '../../../common/types/index.js';
import {
	hashIssue,
	markerFor,
	parseMarker,
	renderIssue
} from './issue-renderer.js';

function makeTask(overrides: Partial<Task> = {}): Task {
	return {
		id: '3',
		title: 'Add login',
		description: 'Users can sign in',
		status: 'pending',
		priority: 'high',
		dependencies: [],
		details: 'Use bcrypt',
		testStrategy: 'Unit tests',
		subtasks: [],
		...overrides
	};
}

describe('renderIssue', () => {
	it('puts the task id in the title and the hidden marker in the body', () => {
		const issue = renderIssue(makeTask(), { tag: 'master' });

		expect(issue.title).toBe('[3] Add login');
		expect(issue.body).toContain('<!-- taskgraph:v1 tag=master id=3 -->');
		expect(issue.body).toContain('Users can sign in');
	});

	it('labels status, priority and tag with the taskgraph prefix', () => {
		const issue = renderIssue(makeTask({ status: 'in-progress' }), {
			tag: 'master'
		});

		expect(issue.labels).toEqual([
			'taskgraph',
			'taskgraph:priority/high',
			'taskgraph:status/in-progress',
			'taskgraph:tag/master'
		]);
		expect(issue.state).toBe('open');
	});

	it('closes done as completed', () => {
		const issue = renderIssue(makeTask({ status: 'done' }), { tag: 'master' });

		expect(issue.state).toBe('closed');
		expect(issue.stateReason).toBe('completed');
		expect(issue.labels.some((l) => l.includes('status/'))).toBe(false);
	});

	it('closes cancelled as not planned', () => {
		const issue = renderIssue(makeTask({ status: 'cancelled' }), {
			tag: 'master'
		});

		expect(issue.state).toBe('closed');
		expect(issue.stateReason).toBe('not_planned');
	});

	it('renders subtasks as a checklist', () => {
		const issue = renderIssue(
			makeTask({
				subtasks: [
					{ id: '1', parentId: '3', title: 'Form', status: 'done' },
					{ id: '2', parentId: '3', title: 'API', status: 'pending' }
				] as Task['subtasks']
			}),
			{ tag: 'master' }
		);

		expect(issue.body).toContain('- [x] 3.1 Form');
		expect(issue.body).toContain('- [ ] 3.2 API');
	});

	it('renders dependencies with known issue numbers as Blocked by lines', () => {
		const issue = renderIssue(makeTask({ dependencies: ['1', '2'] }), {
			tag: 'master',
			issueNumbers: new Map([['1', 11]])
		});

		expect(issue.body).toContain('Blocked by #11');
		expect(issue.body).not.toContain('#2');
	});

	it('omits details and test strategy unless asked', () => {
		const without = renderIssue(makeTask(), { tag: 'master' });
		const withDetails = renderIssue(makeTask(), {
			tag: 'master',
			includeDetails: true
		});

		expect(without.body).not.toContain('bcrypt');
		expect(withDetails.body).toContain('Use bcrypt');
		expect(withDetails.body).toContain('Unit tests');
	});
});

describe('marker', () => {
	it('round-trips tag and id, including odd characters', () => {
		const body = `${markerFor('my tag', '1.2')}\n\nintro`;

		expect(parseMarker(body)).toEqual({ tag: 'my tag', id: '1.2' });
	});

	it('reads the marker only from the first line, where render writes it', () => {
		const body = `intro\n${markerFor('master', '1')}\n`;

		expect(parseMarker(body)).toBeNull();
	});

	it('reads a first-line marker from a body with CRLF line endings', () => {
		const body = `${markerFor('master', '1')}\r\n\r\nintro`;

		expect(parseMarker(body)).toEqual({ tag: 'master', id: '1' });
	});

	it.each([
		['leading whitespace', ` ${markerFor('master', '1')}\nintro`],
		['a byte order mark', `﻿${markerFor('master', '1')}\nintro`],
		['text after it on the line', `${markerFor('master', '1')} intro`]
	])('ignores a marker line with %s', (_case, body) => {
		expect(parseMarker(body)).toBeNull();
	});

	it('returns null when there is no marker', () => {
		expect(parseMarker('plain issue')).toBeNull();
	});
});

describe('hashIssue', () => {
	it('is stable for equal content and changes with any field', () => {
		const a = renderIssue(makeTask(), { tag: 'master' });
		const b = renderIssue(makeTask(), { tag: 'master' });
		const c = renderIssue(makeTask({ title: 'Other' }), { tag: 'master' });

		expect(hashIssue(a)).toBe(hashIssue(b));
		expect(hashIssue(a)).not.toBe(hashIssue(c));
	});
});
