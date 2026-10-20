import { describe, expect, it } from 'vitest';
import { formatAddedSubtasks } from './subtask-summary-formatters.js';

// Strip ANSI codes so assertions read like the terminal does
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, '');

describe('formatAddedSubtasks', () => {
	it('confirms the count and lists each new subtask with its full ID', () => {
		const text = formatAddedSubtasks(3, [
			{ id: 1, title: 'Implement fetchTitle helper' },
			{ id: 2, title: 'Wire the add command to storage' }
		]);

		expect(plain(text)).toBe(
			[
				'✓ Added 2 subtasks to task 3',
				'  3.1  Implement fetchTitle helper',
				'  3.2  Wire the add command to storage'
			].join('\n')
		);
	});

	it('uses the singular for one subtask', () => {
		const text = formatAddedSubtasks(7, [{ id: 4, title: 'Only one' }]);

		expect(plain(text).split('\n')[0]).toBe('✓ Added 1 subtask to task 7');
	});

	it('aligns titles when IDs have different widths', () => {
		const subtasks = Array.from({ length: 10 }, (_, i) => ({
			id: i + 1,
			title: `Step ${i + 1}`
		}));

		const lines = plain(formatAddedSubtasks(2, subtasks)).split('\n');

		expect(lines[1]).toBe('  2.1   Step 1');
		expect(lines[10]).toBe('  2.10  Step 10');
	});

	it('cuts long titles to fit one terminal line', () => {
		const text = formatAddedSubtasks(
			1,
			[{ id: 1, title: 'x'.repeat(200) }],
			40
		);
		const line = plain(text).split('\n')[1];

		expect(line.length).toBe(40);
		expect(line.endsWith('…')).toBe(true);
	});
});
