import { describe, expect, it } from 'vitest';
import {
	formatArchiveResult,
	formatRestoreResult
} from './archive-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

const tasks = [
	{ id: '3', title: 'Set up the database schema', status: 'done' },
	{ id: '12', title: 'Build the login API', status: 'cancelled' }
];

describe('formatArchiveResult', () => {
	it('says what a real run moved in one line', () => {
		const text = formatArchiveResult({
			tasks,
			olderThanDays: 30,
			dryRun: false
		});

		expect(plain(text)).toBe(
			'✓ Archived 2 tasks done or cancelled 30+ days ago: 3, 12'
		);
	});

	it('uses the singular for one task and one day', () => {
		const text = formatArchiveResult({
			tasks: [tasks[0]],
			olderThanDays: 1,
			dryRun: false
		});

		expect(plain(text)).toBe(
			'✓ Archived 1 task done or cancelled 1+ day ago: 3'
		);
	});

	it('drops the age when every finished task qualifies', () => {
		const text = formatArchiveResult({
			tasks: [tasks[0]],
			olderThanDays: 0,
			dryRun: false
		});

		expect(plain(text)).toBe('✓ Archived 1 task done or cancelled: 3');
	});

	it('lists each task on a dry run, then the command that moves them', () => {
		const text = formatArchiveResult({
			tasks,
			olderThanDays: 30,
			dryRun: true
		});

		expect(plain(text).split('\n')).toEqual([
			'Would archive 2 tasks done or cancelled 30+ days ago',
			'  3   ✓ done       Set up the database schema',
			'  12  x cancelled  Build the login API',
			'Run taskgraph archive to move them'
		]);
	});

	it('says nothing qualified, for a real run and a dry run', () => {
		expect(
			plain(
				formatArchiveResult({ tasks: [], olderThanDays: 30, dryRun: false })
			)
		).toBe('No tasks done or cancelled 30+ days ago; nothing archived');
		expect(
			plain(formatArchiveResult({ tasks: [], olderThanDays: 30, dryRun: true }))
		).toBe('No tasks done or cancelled 30+ days ago; nothing to archive');
	});

	it('keeps every line within the terminal width', () => {
		const many = Array.from({ length: 40 }, (_, i) => ({
			id: String(100 + i),
			title: 'x'.repeat(200),
			status: 'done'
		}));

		for (const dryRun of [false, true]) {
			const lines = plain(
				formatArchiveResult({ tasks: many, olderThanDays: 30, dryRun }, 80)
			).split('\n');
			for (const line of lines) {
				expect(line.length).toBeLessThanOrEqual(80);
			}
			expect(lines.join('\n')).toContain('…');
		}
	});
});

describe('formatRestoreResult', () => {
	it('names the restored task', () => {
		expect(
			plain(formatRestoreResult({ id: '12', title: 'Build the login API' }))
		).toBe('✓ Restored task 12  Build the login API');
	});

	it('cuts a long title to fit the terminal width', () => {
		const line = plain(
			formatRestoreResult({ id: '12', title: 'x'.repeat(200) }, 60)
		);

		expect(line.length).toBeLessThanOrEqual(60);
		expect(line.endsWith('…')).toBe(true);
	});
});
