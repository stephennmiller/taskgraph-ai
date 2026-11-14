/**
 * @fileoverview The Notes section of `taskgraph show`, and `show 1,2` leaving
 * out the next step (#1148)
 */

import { stripVTControlCharacters } from 'node:util';
import { appendNote } from '@tm/core';
import { createTask } from '@tm/core/testing';
import { describe, expect, it } from 'vitest';
import { formatTaskDetail } from './task-detail-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);
const widest = (text: string) =>
	Math.max(
		...plain(text)
			.split('\n')
			.map((line) => line.length)
	);

// #1148: notes printed under Details as raw <info added on …> tags
describe('formatTaskDetail notes', () => {
	const year = new Date().getFullYear();
	// Local times, so the expected text is the same in any time zone
	const at = (...parts: [number, number, number, number, number]) =>
		new Date(...parts).toISOString();
	const noted = (details: string | undefined) =>
		createTask({
			id: 1,
			title: 'Set up the database schema',
			details: appendNote(
				appendNote(details, 'fixed the thing', at(year, 10, 2, 9, 5)),
				'Chose argon2 over bcrypt: the login API already depends on it, and the benchmarks on the CI box put a cost-12 bcrypt hash at 310 ms',
				at(year, 10, 12, 19, 47)
			)
		});

	it('lists each note with its local date and time, oldest first, apart from the details', () => {
		const output = plain(
			formatTaskDetail(noted('Use Postgres 16.'), { width: 80, fence: false })
		);

		expect(output).toContain(
			[
				'Details',
				'  Use Postgres 16.',
				'',
				'Notes',
				'  Nov 2 09:05   fixed the thing',
				'  Nov 12 19:47  Chose argon2 over bcrypt: the login API already depends on it,',
				'                and the benchmarks on the CI box put a cost-12 bcrypt hash at',
				'                310 ms',
				'',
				'Next:'
			].join('\n')
		);
		expect(output).not.toContain('info added on');
		expect(widest(output)).toBeLessThanOrEqual(80);
	});

	it('prints no Details heading when the details are only notes', () => {
		const output = plain(formatTaskDetail(noted(undefined), { width: 80 }));

		expect(output).not.toContain('Details');
		expect(output).toContain('\nNotes\n  Nov 2 09:05   fixed the thing\n');
	});

	it('prints the same section in a pipe, inside the fence', () => {
		const output = plain(
			formatTaskDetail(noted(undefined), { width: 80, rawText: true })
		);
		const inside = output.split('<task-data>')[1].split('</task-data>')[0];

		expect(inside).toContain('\nNotes\n  Nov 2 09:05   fixed the thing\n');
		expect(inside).toContain('\n                310 ms\n');
	});

	it('keeps the lines of a note under its first, and names the year of an older one', () => {
		const task = createTask({
			id: 1,
			title: 'Set up the database schema',
			details: appendNote(
				'',
				'Tried:\n- bcrypt\n- argon2',
				at(2020, 0, 5, 8, 30)
			)
		});

		const output = plain(formatTaskDetail(task, { width: 80, rawText: true }));

		expect(output).toContain(
			[
				'  Jan 5 2020 08:30  Tried:',
				'                    - bcrypt',
				'                    - argon2'
			].join('\n')
		);
	});

	it('removes escape sequences from a note', () => {
		const task = createTask({
			id: 1,
			title: 'Set up the database schema',
			details: appendNote(
				'',
				'Clear \u001b[2Jscreen\u0007',
				at(year, 0, 5, 8, 30)
			)
		});

		const output = formatTaskDetail(task, { width: 80 });

		expect(output).not.toMatch(/\u001b\[2J|\u0007/);
		expect(plain(output)).toContain('Jan 5 08:30  Clear screen');
	});
});

describe('formatTaskDetail without a next step', () => {
	it('leaves the Next line out, as show does for several IDs', () => {
		const task = createTask({ id: 2, title: 'Email and password sign-in' });

		expect(plain(formatTaskDetail(task))).toContain('\nNext: ');
		expect(plain(formatTaskDetail(task, { nextStep: false }))).not.toContain(
			'Next:'
		);
	});
});
