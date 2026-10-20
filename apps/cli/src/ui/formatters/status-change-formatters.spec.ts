import { describe, expect, it } from 'vitest';
import { formatStatusChanges } from './status-change-formatters.js';

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
