import type { BlockerExplanation, BlockerNode } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { renderBlockerExplanation } from './blocker-explanation.component.js';

const plain = (lines: string[]) =>
	lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));

const node = (
	id: string,
	blockers: BlockerNode[] = [],
	extra: Partial<BlockerNode> = {}
): BlockerNode => ({
	id,
	title: `Task ${id}`,
	status: 'pending',
	blockers,
	...extra
});

const explanation = (
	blockers: BlockerNode[],
	extra: Partial<BlockerExplanation> = {}
): BlockerExplanation => ({
	id: '7',
	title: 'Task 7',
	status: 'pending',
	blocked: blockers.length > 0,
	blockers,
	rootCauses: [],
	...extra
});

describe('renderBlockerExplanation', () => {
	it('says a task with nothing in its way is ready to start', () => {
		const lines = plain(renderBlockerExplanation(explanation([])));

		expect(lines).toEqual([
			'○ 7  Task 7',
			'Not blocked. Start it with: taskgraph set-status --id=7 --status=in-progress'
		]);
	});

	it('says a finished task is not blocked', () => {
		const lines = plain(
			renderBlockerExplanation(explanation([], { status: 'done' }))
		);

		expect(lines).toEqual(['✓ 7  Task 7', 'Already done.']);
	});

	it('draws the blocker chain and what to do about each root cause', () => {
		const ready = node('3', [], { kind: 'ready' });
		const lines = plain(
			renderBlockerExplanation(
				explanation([node('5', [ready]), node('4', [], { kind: 'ready' })], {
					rootCauses: [
						{ id: '3', title: 'Task 3', status: 'pending', kind: 'ready' },
						{ id: '4', title: 'Task 4', status: 'pending', kind: 'ready' }
					]
				})
			)
		);

		expect(lines).toEqual([
			'○ 7  Task 7',
			'Blocked by:',
			'├─ ○ 5  Task 5',
			'│  └─ ○ 3  Task 3  ← ready to start',
			'└─ ○ 4  Task 4  ← ready to start',
			'',
			'To unblock:',
			'  Do 3 (Task 3) and 4 (Task 4): nothing else stands in their way.'
		]);
	});

	it('shows a repeated task once and notes the repeat', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation([
					node('2', [node('1', [], { kind: 'ready' })]),
					node('3', [node('1', [], { kind: 'ready', repeated: true })])
				])
			)
		);

		expect(lines).toContain('   └─ ○ 1  Task 1  ← shown above');
	});

	it('suggests the command that removes a missing dependency from the task that lists it', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation(
					[node('5', [{ id: '99', kind: 'missing', blockers: [] }])],
					{
						rootCauses: [{ id: '99', kind: 'missing', listedBy: ['5'] }]
					}
				)
			)
		);

		expect(lines).toContain('└─ ○ 5  Task 5');
		expect(lines).toContain('   └─ ⚠ 99  no such task  ← missing');
		expect(lines).toContain(
			'  99 is not a task. Remove it with: taskgraph remove-dependency --id=5 --depends-on=99'
		);
	});

	it('names stalled tasks and how to reopen them', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation([node('2', [], { kind: 'stalled', status: 'deferred' })], {
					rootCauses: [
						{ id: '2', title: 'Task 2', status: 'deferred', kind: 'stalled' }
					]
				})
			)
		);

		expect(lines).toContain('└─ – 2  Task 2  ← deferred, needs a decision');
		expect(lines).toContain(
			'  2 is deferred. Reopen it with: taskgraph set-status --id=2 --status=pending'
		);
	});

	it('shows where a cycle closes and how to break it', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation(
					[node('1', [node('2', [node('1', [], { kind: 'cycle' })])])],
					{
						rootCauses: [
							{
								id: '1',
								title: 'Task 1',
								status: 'pending',
								kind: 'cycle',
								cycle: ['1', '2'],
								edges: [{ from: '2', to: '1' }]
							}
						]
					}
				)
			)
		);

		expect(lines).toContain('      └─ ○ 1  Task 1  ← loops back');
		expect(lines).toContain(
			'  1, 2 depend on each other. Break the loop with: taskgraph remove-dependency --id=2 --depends-on=1'
		);
	});

	it('suggests removing a missing ID from every task that lists it', () => {
		const missing = (): BlockerNode => ({
			id: '99',
			kind: 'missing',
			blockers: []
		});
		const lines = plain(
			renderBlockerExplanation(
				explanation([node('1', [missing()]), node('2', [missing()])], {
					rootCauses: [{ id: '99', kind: 'missing', listedBy: ['1', '2'] }]
				}),
				// Wide enough to keep the step on one line
				{ width: 200 }
			)
		);

		expect(lines).toContain(
			'  99 is not a task. Remove it with: taskgraph remove-dependency --id=1 --depends-on=99 and taskgraph remove-dependency --id=2 --depends-on=99'
		);
	});

	it('names a self-dependency and how to remove it', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation([node('7', [], { kind: 'cycle' })], {
					rootCauses: [
						{
							id: '7',
							title: 'Task 7',
							status: 'pending',
							kind: 'cycle',
							cycle: ['7'],
							edges: [{ from: '7', to: '7' }]
						}
					]
				})
			)
		);

		expect(lines).toContain(
			'  7 depends on itself. Remove it with: taskgraph remove-dependency --id=7 --depends-on=7'
		);
	});

	it('lists every edge that closes a loop', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation(
					[node('1', [node('2', [node('1', [], { kind: 'cycle' })])])],
					{
						rootCauses: [
							{
								id: '1',
								kind: 'cycle',
								cycle: ['1', '2', '3'],
								edges: [
									{ from: '2', to: '1' },
									{ from: '3', to: '1' }
								]
							}
						]
					}
				),
				{ width: 200 }
			)
		);

		expect(lines.at(-1)).toBe(
			'  1, 2, 3 depend on each other. Break the loop with: taskgraph remove-dependency --id=2 --depends-on=1 and taskgraph remove-dependency --id=3 --depends-on=1'
		);
	});

	it('wraps each unblock step to the width with a hanging indent', () => {
		const lines = plain(
			renderBlockerExplanation(
				explanation([node('5'), node('4')], {
					rootCauses: [
						{
							id: '3',
							title: 'Design the schema',
							status: 'pending',
							kind: 'ready'
						},
						{
							id: '4',
							title: 'Design the dashboard layout for admins',
							status: 'pending',
							kind: 'ready'
						}
					]
				}),
				{ width: 80 }
			)
		);

		const steps = lines.slice(lines.indexOf('To unblock:') + 1);
		expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(80);
		expect(steps).toEqual([
			'  Do 3 (Design the schema) and 4 (Design the dashboard layout for admins):',
			'    nothing else stands in their way.'
		]);
	});

	const missingStep = () =>
		explanation([node('5', [node('99', [], { kind: 'missing' })])], {
			rootCauses: [{ id: '99', kind: 'missing', listedBy: ['5'] }]
		});

	it('moves a command to the next line whole instead of splitting it', () => {
		const lines = plain(renderBlockerExplanation(missingStep(), { width: 76 }));

		expect(lines.slice(lines.indexOf('To unblock:') + 1)).toEqual([
			'  99 is not a task. Remove it with:',
			'    taskgraph remove-dependency --id=5 --depends-on=99'
		]);
	});

	it('splits a command at its spaces when it is wider than the line', () => {
		const lines = plain(renderBlockerExplanation(missingStep(), { width: 40 }));

		expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(40);
		expect(lines.join(' ').replace(/ +/g, ' ')).toContain(
			'taskgraph remove-dependency --id=5 --depends-on=99'
		);
	});
});
