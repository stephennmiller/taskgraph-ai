import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatReadmeSync } from './readme-sync-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);

describe('formatReadmeSync', () => {
	it('says what it wrote in one line', () => {
		expect(plain(formatReadmeSync({}))).toBe('✓ Synced tasks to README.md');
	});

	it('adds the subtask and status options, with escape codes removed', () => {
		expect(
			plain(
				formatReadmeSync({ withSubtasks: true, status: 'pending\u001b[2J' })
			)
		).toBe('✓ Synced tasks to README.md · with subtasks · status: pending');
	});
});
