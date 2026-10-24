import { describe, expect, it } from 'vitest';
import {
	formatCrossTagConflicts,
	formatMoves,
	formatTagMove
} from './move-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');

describe('formatMoves', () => {
	it('prints one line per move, then the pairs it skipped', () => {
		const output = plain(
			formatMoves(
				[
					{ message: 'Moved task 3 to new ID 10' },
					{ message: 'Converted subtask 4.1 to task 6' }
				],
				[{ fromId: '8', toId: '8' }]
			)
		);

		expect(output.split('\n')).toEqual([
			'✓ Moved task 3 to new ID 10',
			'✓ Converted subtask 4.1 to task 6',
			'Skipped 8 → 8 (same ID)'
		]);
	});
});

describe('formatTagMove', () => {
	it('says how many moved, and what to run after dropping dependencies', () => {
		expect(plain(formatTagMove(1, 'backlog', 'sprint', false))).toBe(
			'✓ Moved 1 task from "backlog" to "sprint"'
		);
		expect(
			plain(formatTagMove(2, 'backlog', 'sprint', true)).split('\n')
		).toEqual([
			'✓ Moved 2 tasks from "backlog" to "sprint"',
			'Next: taskgraph validate-dependencies, then taskgraph fix-dependencies'
		]);
	});

	it('strips escape codes from tag names', () => {
		expect(formatTagMove(1, 'a\x1b[2Jb', 'c', false)).not.toContain('\x1b[2J');
	});
});

describe('formatCrossTagConflicts', () => {
	it('lists each dependency that stays behind', () => {
		expect(
			formatCrossTagConflicts([
				{
					taskId: 5,
					dependencyId: 4,
					dependencyTag: 'backlog',
					message: 'Task 5 depends on 4 (in backlog)'
				}
			])
		).toBe('  Task 5 depends on 4 (in backlog)');
	});
});
