/**
 * @fileoverview What the github command prints (#1148): `github status` as a
 * row per check, and counts that say "1 task", not "1 task(s)"
 */

import { stripVTControlCharacters } from 'node:util';
import type { PullPlan, PushPlan } from '@tm/core';
import { describe, expect, it } from 'vitest';
import { formatPlan, formatPullPlan, formatStatus } from './github-format.js';

const plain = (text: string) => stripVTControlCharacters(text);

describe('formatStatus', () => {
	it('prints a row per check, with the linked tasks out of all of them', () => {
		const text = formatStatus({
			ghAvailable: true,
			repo: 'acme/app',
			linkedTasks: 2,
			unlinkedTasks: 3
		});

		expect(plain(text)).toBe(
			[
				'✓ gh CLI  signed in',
				'✓ Repo    acme/app',
				'✓ Linked  2 of 5 tasks'
			].join('\n')
		);
	});

	it('puts the fix under a failed check, and counts one task as one', () => {
		const text = formatStatus({
			ghAvailable: false,
			repo: null,
			linkedTasks: 0,
			unlinkedTasks: 1
		});

		// No Repo row: without gh it was never looked for
		expect(plain(text)).toBe(
			[
				'✗ gh CLI  not available',
				'  Install the GitHub CLI, then run gh auth login',
				'– Linked  0 of 1 task'
			].join('\n')
		);
	});

	it('says how to name the repo when gh is signed in and finds none', () => {
		const text = formatStatus({
			ghAvailable: true,
			repo: null,
			linkedTasks: 0,
			unlinkedTasks: 0
		});

		expect(plain(text)).toBe(
			[
				'✓ gh CLI  signed in',
				'✗ Repo    not detected',
				'  Pass --repo owner/name, or run this in a GitHub checkout',
				'– Linked  0 of 0 tasks'
			].join('\n')
		);
	});

	it('removes escape sequences from the repo name', () => {
		const text = formatStatus({
			ghAvailable: true,
			repo: 'acme/app\u001b[2J',
			linkedTasks: 0,
			unlinkedTasks: 0
		});

		expect(text).not.toContain('\u001b[2J');
	});
});

describe('plurals in the push and pull plans', () => {
	const conflict = (taskId: string): PullPlan['steps'][number] => ({
		action: 'conflict',
		tag: 'master',
		taskId,
		title: 'Second',
		issueNumber: 2,
		from: 'blocked',
		to: 'done'
	});
	const orphan = (issueNumber: number) => ({
		issueNumber,
		url: 'u',
		title: 'Gone'
	});
	const pushPlan = (orphans: PushPlan['orphans']): PushPlan => ({
		repo: 'acme/app',
		steps: [],
		orphans
	});

	it('counts one conflict as one, on lines that fit 80 columns', () => {
		const text = plain(
			formatPullPlan({ repo: 'acme/app', steps: [conflict('2')] })
		);

		expect(text).toContain('1 conflict,');
		expect(text).toContain(
			'1 task changed on both sides and keeps its local status\nRun taskgraph github push to overwrite GitHub with it'
		);
	});

	it('counts several conflicts as several', () => {
		const text = plain(
			formatPullPlan({
				repo: 'acme/app',
				steps: [conflict('2'), conflict('3')]
			})
		);

		expect(text).toContain('2 conflicts,');
		expect(text).toContain(
			'2 tasks changed on both sides and keep their local status'
		);
	});

	it('counts one orphaned issue as one, and several as several', () => {
		expect(plain(formatPlan(pushPlan([orphan(9)])))).toContain(
			'1 open issue has no local task (pass --close-orphans to close it):'
		);
		expect(plain(formatPlan(pushPlan([orphan(9), orphan(10)])))).toContain(
			'2 open issues have no local task (pass --close-orphans to close them):'
		);
	});
});
