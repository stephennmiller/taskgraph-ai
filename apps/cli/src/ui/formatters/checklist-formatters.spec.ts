import { buildChecklist } from '@tm/core';
import { describe, expect, it } from 'vitest';
import {
	formatChecklist,
	formatChecklistUpdate,
	formatUncheckedCriteria
} from './checklist-formatters.js';

import {
	HOSTILE,
	sgrFree,
	UNSAFE
} from '../../../tests/helpers/hostile-text.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

const checklist = buildChecklist(
	{
		acceptanceCriteria: [
			{ text: 'Users can log in with email and password', checked: true },
			'JWT tokens are issued on successful login'
		]
	},
	['Tests pass']
);

describe('formatChecklist', () => {
	it('groups criteria and the Definition of Done, numbered for --check', () => {
		expect(plain(formatChecklist(checklist, 80)).split('\n')).toEqual([
			'Acceptance criteria  1/2',
			'  ✓ 1  Users can log in with email and password',
			'  ○ 2  JWT tokens are issued on successful login',
			'Definition of Done  0/1',
			'  ○ 3  Tests pass'
		]);
	});

	it('leaves out a group with no items', () => {
		const onlyDone = buildChecklist({}, ['Tests pass']);

		expect(plain(formatChecklist(onlyDone, 80)).split('\n')).toEqual([
			'Definition of Done  0/1',
			'  ○ 1  Tests pass'
		]);
	});

	it('wraps long criteria under the text, within 80 columns', () => {
		const long = buildChecklist(
			{
				acceptanceCriteria: [
					'Refresh tokens rotate on every use and a reused refresh token revokes the whole token family'
				]
			},
			[]
		);

		const lines = plain(formatChecklist(long, 80)).split('\n');

		expect(lines.every((line) => line.length <= 80)).toBe(true);
		expect(lines[2]).toMatch(/^ {7}\S/);
	});
});

describe('formatChecklistUpdate', () => {
	it('gives the count and what is still unchecked', () => {
		expect(
			plain(formatChecklistUpdate('3', checklist, 80)).split('\n')
		).toEqual([
			'✓ Task 3  1 of 3 checked',
			'  ○ 2  JWT tokens are issued on successful login',
			'  ○ 3  Tests pass'
		]);
	});

	it('points at set-status done once everything is checked', () => {
		const done = buildChecklist(
			{ acceptanceCriteria: [{ text: 'Ok', checked: true }] },
			[]
		);

		expect(plain(formatChecklistUpdate('3', done, 80)).split('\n')).toEqual([
			'✓ Task 3  all 1 checked',
			'Next: taskgraph set-status 3 done'
		]);
	});
});

describe('formatUncheckedCriteria', () => {
	it('lists what is unchecked, then the command that fixes it', () => {
		expect(
			plain(
				formatUncheckedCriteria(
					'2 criteria unchecked on task 3',
					'3',
					checklist.unchecked,
					80
				)
			).split('\n')
		).toEqual([
			'✗ 2 criteria unchecked on task 3',
			'  ○ 2  JWT tokens are issued on successful login',
			'  ○ 3  Tests pass',
			'  Check them with taskgraph set-status 3 --check 2,3, or pass --force'
		]);
	});
});

describe('checklist output with escape sequences in criteria and config', () => {
	it('prints criteria and Definition of Done items without them', () => {
		const hostile = buildChecklist({ acceptanceCriteria: [HOSTILE] }, [
			HOSTILE
		]);
		const outputs = [
			formatChecklist(hostile, 80),
			formatChecklistUpdate('1', hostile, 80),
			formatUncheckedCriteria(HOSTILE, '1', hostile.items, 80)
		].map(sgrFree);

		expect(outputs[0]).toContain('○ 1  Fix login');
		for (const out of outputs) expect(out).not.toMatch(UNSAFE);
	});
});
