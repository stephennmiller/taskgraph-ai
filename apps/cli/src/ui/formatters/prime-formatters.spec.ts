import type { PrimeContext } from '@tm/core';
import { PRIME_RULES } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	formatPrimeContext,
	formatUnnotedReminder
} from './prime-formatters.js';

const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

const context = (overrides: Partial<PrimeContext> = {}): PrimeContext => ({
	tag: 'master',
	counts: { total: 12, done: 4 },
	inProgress: [
		{
			id: '3.2',
			title: 'Add the login endpoint',
			status: 'in-progress',
			priority: 'high',
			parentTitle: 'Auth',
			doneWhen: ['Returns 401 on a bad password', 'Rate limited per IP']
		}
	],
	ready: [
		{
			id: '3.4',
			title: 'Rate limit the endpoint',
			status: 'pending',
			priority: 'high',
			parentTitle: 'Auth'
		},
		{ id: '5', title: 'Settings page', status: 'pending', priority: 'medium' }
	],
	rules: PRIME_RULES,
	...overrides
});

const render = (c: PrimeContext, width = 80) =>
	stripAnsi(formatPrimeContext(c, width));

describe('formatPrimeContext', () => {
	it('leads with what TaskGraph is, the tag and progress', () => {
		const [first] = render(context()).split('\n');

		expect(first).toBe(
			'TaskGraph tracks work in this project · tag master · 4 of 12 tasks done'
		);
	});

	it('shows the in-progress task, its done-when criteria and ready tasks', () => {
		const text = render(context());

		expect(text).toContain(
			[
				'In progress',
				'  3.2  Add the login endpoint · in Auth',
				'       Done when:',
				'       - Returns 401 on a bad password',
				'       - Rate limited per IP',
				'',
				'Ready next',
				'  3.4  Rate limit the endpoint · in Auth',
				'  5    Settings page'
			].join('\n')
		);
	});

	it('prints all five rules with their commands', () => {
		const text = render(context());

		for (const rule of PRIME_RULES) {
			expect(text).toContain(rule.text);
			expect(text).toContain(rule.command);
		}
		expect(text).toContain('  5. Commit with the task ID in the message');
	});

	it('stays under 40 lines and 80 columns with long titles and criteria', () => {
		const long = 'word '.repeat(80).trim();
		const lines = render(
			context({
				inProgress: [
					{
						id: '12.10',
						title: long,
						status: 'in-progress',
						priority: 'high',
						parentTitle: long,
						doneWhen: [long, long, long, long]
					},
					{
						id: '7',
						title: long,
						status: 'in-progress',
						priority: 'low',
						doneWhen: [long]
					}
				],
				ready: [1, 2, 3].map((n) => ({
					id: String(n),
					title: long,
					status: 'pending',
					priority: 'medium',
					parentTitle: long
				}))
			})
		).split('\n');

		expect(lines.length).toBeLessThan(40);
		for (const line of lines) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});

	it('cuts a long title with an ellipsis and points at show for hidden criteria', () => {
		const long = 'word '.repeat(80).trim();
		const text = render(
			context({
				inProgress: [
					{
						id: '1',
						title: 'T'.repeat(200),
						status: 'in-progress',
						priority: 'medium',
						doneWhen: [long, long, long]
					}
				]
			})
		);

		expect(text).toMatch(/ {2}1 {2}T+…\n/);
		expect(text).toContain('1 more: taskgraph show 1');
	});

	it('says when nothing is in progress and when nothing is ready', () => {
		const text = render(context({ inProgress: [], ready: [] }));

		expect(text).toContain('Nothing in progress.');
		expect(text).not.toContain('Claim a ready task first');
		expect(text).toContain('Nothing else is ready');
	});

	it('asks for a claim when nothing is in progress but a task is ready', () => {
		const text = render(context({ inProgress: [] }));

		expect(text).toContain('Nothing in progress. Claim a ready task first.');
	});

	it('shows two in-progress tasks in full and counts the rest, under 40 lines', () => {
		const long = 'word '.repeat(40).trim();
		const lines = render(
			context({
				inProgress: [1, 2, 3, 4, 5].map((id) => ({
					id: String(id),
					title: `Task ${id}`,
					status: 'in-progress',
					priority: 'medium',
					doneWhen: [long, long, long]
				})),
				ready: [1, 2, 3].map((id) => ({
					id: `9.${id}`,
					title: 'Ready',
					status: 'pending',
					priority: 'medium'
				}))
			})
		).split('\n');

		expect(lines).toContain('  1  Task 1');
		expect(lines).toContain('  2  Task 2');
		expect(lines).not.toContain('  3  Task 3');
		expect(lines).toContain(
			'  3 more in progress: taskgraph list --status=in-progress'
		);
		expect(lines.length).toBeLessThan(40);
	});

	it('says all tasks are done when they are', () => {
		const text = render(
			context({ inProgress: [], ready: [], counts: { total: 2, done: 2 } })
		);

		expect(text).toContain('All tasks are done.');
	});

	it('flags an in-progress task with no done-when criteria', () => {
		const text = render(
			context({
				inProgress: [
					{
						id: '2',
						title: 'Vague',
						status: 'in-progress',
						priority: 'medium',
						doneWhen: []
					}
				]
			})
		);

		expect(text).toContain(
			'No done-when criteria. Ask, or add a test strategy.'
		);
	});

	it('points an empty project at parse-prd and add-task, then the rules', () => {
		const text = render(
			context({ counts: { total: 0, done: 0 }, inProgress: [], ready: [] })
		);

		expect(text).toContain('0 of 0 tasks done');
		expect(text).toContain('No tasks yet. Add some with:');
		expect(text).toContain('taskgraph parse-prd <file>');
		expect(text).not.toContain('In progress');
		expect(text).not.toContain('Next:');
		expect(text).toContain('Rules');
	});
});

describe('formatUnnotedReminder', () => {
	const task = (id: string) => ({
		id,
		title: `Task "${id}"; rm -rf /`,
		status: 'in-progress',
		priority: 'medium'
	});

	it('names the one task and gives its note and done commands', () => {
		expect(stripAnsi(formatUnnotedReminder([task('3.2')]))).toBe(
			[
				'Task 3.2 is still in progress with no note from this session.',
				'If you worked on it, log what you did:',
				'  taskgraph note 3.2 "<what you did or decided>"',
				"If it's finished, check its criteria and close it:",
				'  taskgraph set-status --id=3.2 --status=done',
				"If you didn't work on it, say so in one line and stop."
			].join('\n')
		);
	});

	it('lists several tasks and uses <id> in the commands', () => {
		const lines = stripAnsi(
			formatUnnotedReminder([task('1'), task('3.2'), task('7')])
		).split('\n');

		expect(lines[0]).toBe(
			'Tasks 1, 3.2 and 7 are still in progress with no note from this session.'
		);
		expect(lines[2]).toBe('  taskgraph note <id> "<what you did or decided>"');
		expect(lines[5]).toBe(
			"If you didn't work on them, say so in one line and stop."
		);
	});

	it('leaves task titles out and fits 80 columns', () => {
		const text = stripAnsi(formatUnnotedReminder([task('12.10')]));

		expect(text).not.toContain('rm -rf');
		for (const line of text.split('\n')) {
			expect(line.length).toBeLessThanOrEqual(80);
		}
	});
});
