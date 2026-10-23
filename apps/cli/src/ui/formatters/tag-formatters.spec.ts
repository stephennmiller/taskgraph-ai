import { stripVTControlCharacters as plain } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatTagCopied,
	formatTagCreated,
	formatTagDeleted,
	formatTagIndicator,
	formatTagList,
	formatTagRenamed,
	formatTagSwitched,
	type TagSummary
} from './tag-formatters.js';

import {
	HOSTILE,
	sgrFree,
	UNSAFE
} from '../../../tests/helpers/hostile-text.js';

const lines = (text: string) => plain(text).split('\n');

describe('tag result lines', () => {
	it('creates: result, description, then how to switch', () => {
		expect(
			lines(
				formatTagCreated({
					tagName: 'feature-auth',
					tasksCopied: 0,
					sourceTag: null,
					description: 'Auth work'
				})
			)
		).toEqual([
			'✓ Created tag feature-auth',
			'  Auth work',
			'Switch to it with taskgraph tags use feature-auth'
		]);
	});

	it('creates: says where copied tasks came from', () => {
		expect(
			lines(
				formatTagCreated({
					tagName: 'sprint-2',
					tasksCopied: 4,
					sourceTag: 'master'
				})
			)[0]
		).toBe('✓ Created tag sprint-2 · 4 tasks from master');
	});

	it('creates: cuts a long description to the width', () => {
		const output = formatTagCreated(
			{ tagName: 'x', tasksCopied: 0, description: 'word '.repeat(40) },
			40
		);
		expect(lines(output)[1].length).toBeLessThanOrEqual(40);
	});

	it('switches: count, then the next task', () => {
		expect(
			lines(
				formatTagSwitched({
					previousTag: 'feature-login',
					currentTag: 'master',
					taskCount: 4,
					nextTask: { id: 1, title: 'Set up the Express API server' }
				})
			)
		).toEqual([
			'✓ Switched to master · 4 tasks',
			'Next: 1  Set up the Express API server'
		]);
	});

	it('switches: to an empty tag, says how to add tasks', () => {
		expect(
			lines(
				formatTagSwitched({
					previousTag: 'master',
					currentTag: 'feature-auth',
					taskCount: 0,
					nextTask: null
				})
			)
		).toEqual([
			'✓ Switched to feature-auth · 0 tasks',
			'Add tasks with taskgraph add-task or taskgraph parse-prd <file>'
		]);
	});

	it('switches: says so when nothing is ready', () => {
		expect(
			lines(
				formatTagSwitched({
					previousTag: 'master',
					currentTag: 'blocked',
					taskCount: 1,
					nextTask: null
				})
			)[1]
		).toBe('No task is ready to start');
	});

	it("switches: doesn't claim a switch to the tag already in use", () => {
		expect(
			lines(
				formatTagSwitched({
					previousTag: 'master',
					currentTag: 'master',
					taskCount: 1,
					nextTask: { id: 1, title: 'A' }
				})
			)[0]
		).toBe('Already on master · 1 task');
	});

	it('switches: cuts the next task title to the width', () => {
		const output = formatTagSwitched(
			{
				currentTag: 'master',
				taskCount: 1,
				nextTask: { id: 12, title: 'T'.repeat(200) }
			},
			40
		);
		expect(lines(output)[1].length).toBeLessThanOrEqual(40);
	});

	it('renames, marking the current tag', () => {
		expect(
			plain(
				formatTagRenamed({
					oldName: 'feature-auth',
					newName: 'feature-login',
					isCurrentTag: true
				})
			)
		).toBe('✓ Renamed feature-auth to feature-login · current tag');
		expect(plain(formatTagRenamed({ oldName: 'a', newName: 'b' }))).toBe(
			'✓ Renamed a to b'
		);
	});

	it('copies, with the task count', () => {
		expect(
			lines(
				formatTagCopied({
					sourceName: 'master',
					targetName: 'backup',
					tasksCopied: 4
				})
			)
		).toEqual([
			'✓ Copied master to backup · 4 tasks',
			'Switch to it with taskgraph tags use backup'
		]);
	});

	it('deletes, saying what went with the tag', () => {
		expect(
			plain(formatTagDeleted({ tagName: 'backup', tasksDeleted: 4 }))
		).toBe('✓ Deleted tag backup and its 4 tasks');
		expect(plain(formatTagDeleted({ tagName: 'one', tasksDeleted: 1 }))).toBe(
			'✓ Deleted tag one and its task'
		);
		expect(
			plain(
				formatTagDeleted({
					tagName: 'empty',
					tasksDeleted: 0,
					switchedToMaster: true
				})
			)
		).toBe('✓ Deleted tag empty · switched to master');
	});
});

describe('formatTagList', () => {
	const tags: TagSummary[] = [
		{
			name: 'feature-auth',
			isCurrent: true,
			taskCount: 0,
			readyTasks: 0,
			completedTasks: 0,
			created: '2026-10-20T12:00:00.000Z',
			description: 'Auth work'
		},
		{
			name: 'master',
			isCurrent: false,
			taskCount: 4,
			readyTasks: 2,
			completedTasks: 1,
			created: '2026-10-01T12:00:00.000Z',
			description: 'Tasks for master context'
		}
	];

	it('aligns names and right-aligns counts under their headers', () => {
		expect(lines(formatTagList(tags))).toEqual([
			'  Tag           Tasks  Ready  Done',
			'● feature-auth      0      0     0',
			'  master            4      2     1'
		]);
	});

	it('adds the created date and description with --show-metadata', () => {
		expect(lines(formatTagList(tags, { showMetadata: true }))).toEqual([
			'  Tag           Tasks  Ready  Done  Created     Description',
			'● feature-auth      0      0     0  2026-10-20  Auth work',
			'  master            4      2     1  2026-10-01  Tasks for master context'
		]);
	});

	it('fits 80 columns with a long name and description', () => {
		const long: TagSummary[] = [
			{
				...tags[1],
				name: 'sprint-2-with-a-really-long-name-for-wrapping-checks',
				description: 'A copy kept for the next sprint planning session'
			}
		];
		for (const showMetadata of [false, true]) {
			for (const line of lines(formatTagList(long, { showMetadata }, 80))) {
				expect(line.length).toBeLessThanOrEqual(80);
			}
		}
	});

	it('fits a narrow terminal', () => {
		for (const line of lines(formatTagList(tags, { showMetadata: true }, 50))) {
			expect(line.length).toBeLessThanOrEqual(50);
		}
	});

	it('leaves the date empty instead of failing on one that does not parse', () => {
		const odd: TagSummary[] = [
			{ ...tags[1], created: '20.10.2026' },
			{ ...tags[0], created: 'Unknown' }
		];
		const output = lines(formatTagList(odd, { showMetadata: true }));
		expect(output[1]).toBe(
			'  master            4      2     1              Tasks for master context'
		);
		expect(output[2]).toBe(
			'● feature-auth      0      0     0              Auth work'
		);
	});

	it('says when no tag has ready work', () => {
		expect(formatTagList([], { ready: true })).toBe(
			'No tag has a task ready to start'
		);
	});
});

describe('tag indicator', () => {
	it('is one muted line naming the tag', () => {
		expect(plain(formatTagIndicator('feature-auth'))).toBe(
			'[tag] feature-auth'
		);
	});
});

describe('tag output with escape sequences in tag names and text', () => {
	it('prints names, descriptions and titles without them', () => {
		const outputs = [
			formatTagIndicator(HOSTILE),
			formatTagSwitched({
				currentTag: HOSTILE,
				taskCount: 1,
				nextTask: { id: 1, title: HOSTILE }
			}),
			formatTagList(
				[
					{
						name: HOSTILE,
						isCurrent: false,
						taskCount: 1,
						readyTasks: 1,
						completedTasks: 0,
						description: HOSTILE
					}
				],
				{ showMetadata: true }
			)
		].map(sgrFree);

		expect(outputs[0]).toBe('[tag] Fix login');
		for (const out of outputs) expect(out).not.toMatch(UNSAFE);
	});
});
