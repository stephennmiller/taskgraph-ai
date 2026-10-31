import { describe, expect, it } from 'vitest';
import {
	formatReadyAfterDone,
	formatStatusChanges
} from './status-change-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('formatStatusChanges', () => {
	it('confirms a single change on one line', () => {
		const text = formatStatusChanges([
			{ taskId: '1', oldStatus: 'pending', newStatus: 'in-progress' }
		]);

		expect(plain(text)).toBe('✓ Task 1  ○ pending → ▶ in-progress');
	});

	it('lists several changes under a count, IDs aligned', () => {
		const text = formatStatusChanges([
			{ taskId: '1', oldStatus: 'pending', newStatus: 'done' },
			{ taskId: '1.2', oldStatus: 'in-progress', newStatus: 'done' }
		]);

		expect(plain(text).split('\n')).toEqual([
			'✓ Updated 2 tasks',
			'  1    ○ pending → ✓ done',
			'  1.2  ▶ in-progress → ✓ done'
		]);
	});

	it('says so when the status was already set', () => {
		const text = formatStatusChanges([
			{ taskId: '4', oldStatus: 'done', newStatus: 'done' }
		]);

		expect(plain(text)).toBe('✓ Task 4  ✓ done (unchanged)');
	});
});

describe('formatReadyAfterDone', () => {
	it('lists what became ready, IDs aligned, then the next step', () => {
		const text = formatReadyAfterDone(
			[
				{ id: '3', title: 'Write the login page' },
				{ id: '12.1', title: 'Add logout endpoint' }
			],
			80
		);

		expect(plain(text).split('\n')).toEqual([
			'  Ready now  3     Write the login page',
			'             12.1  Add logout endpoint',
			'Next: taskgraph next'
		]);
	});

	it('gives only the next step when nothing became ready', () => {
		expect(plain(formatReadyAfterDone([], 80))).toBe('Next: taskgraph next');
	});

	it('cuts a long title to the width and strips escape codes', () => {
		const lines = plain(
			formatReadyAfterDone(
				[{ id: '3', title: `\u001b]0;evil\u0007${'x'.repeat(200)}` }],
				80
			)
		).split('\n');

		expect(lines[0]).toHaveLength(80);
		expect(lines[0]).toMatch(/…$/);
		expect(lines[0]).not.toContain('evil\u0007');
	});
});
