import { describe, expect, it } from 'vitest';
import { formatTasksRemoved } from './remove-task-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatTasksRemoved', () => {
	it('names one task', () => {
		expect(plain(formatTasksRemoved(['2']))).toBe('✓ Removed task 2');
	});

	it('names one subtask', () => {
		expect(plain(formatTasksRemoved(['5.1']))).toBe('✓ Removed subtask 5.1');
	});

	it('counts and lists several', () => {
		expect(plain(formatTasksRemoved(['2', '5.1', '7']))).toBe(
			'✓ Removed 3 tasks: 2, 5.1, 7'
		);
	});
});
