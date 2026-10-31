import { describe, expect, it } from 'vitest';
import type { CrossTagConflict } from '@tm/core';
import {
	formatCrossTagConflictHint,
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

describe('formatCrossTagConflictHint', () => {
	const live: CrossTagConflict = {
		taskId: '3',
		dependencyId: '2',
		dependencyTag: 'feat',
		message: 'Task 3 depends on 2 (in feat)'
	};
	const archived: CrossTagConflict = {
		taskId: '3',
		dependencyId: '9',
		dependencyTag: 'feat',
		message: 'Task 3 depends on 9 (archived in feat)',
		archived: true
	};
	const moveTo = '--from=3 --from-tag=feat --to-tag=master';

	it('suggests moving live dependencies along', () => {
		expect(formatCrossTagConflictHint([live], moveTo, 'feat')).toBe(
			'Move them too: `taskgraph move --from=3 --from-tag=feat --to-tag=master --with-dependencies` (tasks that depend on them go in --from), or drop them with --ignore-dependencies'
		);
	});

	it('never suggests --with-dependencies when only archived tasks block the move', () => {
		const hint = formatCrossTagConflictHint([archived], moveTo, 'feat');

		expect(hint).not.toContain('--with-dependencies');
		expect(hint).toBe(
			"Archived tasks can't move: drop them with `taskgraph move --from=3 --from-tag=feat --to-tag=master --ignore-dependencies`, or restore them first with `taskgraph archive restore <id> --tag=feat`"
		);
	});

	it('says archived ones need restoring when both kinds block the move', () => {
		expect(
			formatCrossTagConflictHint([live, archived], moveTo, 'feat')
		).toMatch(
			/--with-dependencies.*Archived ones can't move until restored: `taskgraph archive restore <id> --tag=feat`$/
		);
	});

	it('suggests fix-dependencies for a dependency the source tag lacks (#864)', () => {
		const missing: CrossTagConflict = {
			taskId: '3',
			dependencyId: '9',
			dependencyTag: 'feat',
			message:
				"Task 3 depends on 9, which feat doesn't have (master has a different 9)",
			missing: true
		};

		expect(formatCrossTagConflictHint([missing], moveTo, 'feat')).toBe(
			'Drop them with `taskgraph move --from=3 --from-tag=feat --to-tag=master --ignore-dependencies`, or remove them first with `taskgraph fix-dependencies --tag=feat`'
		);
		expect(formatCrossTagConflictHint([live, missing], moveTo, 'feat')).toMatch(
			/--with-dependencies.*Missing ones can't move; remove them with `taskgraph fix-dependencies --tag=feat`$/
		);
	});

	it('strips escape codes from the tag name', () => {
		expect(
			formatCrossTagConflictHint([archived], moveTo, 'a\x1b[2Jb')
		).not.toContain('\x1b[2J');
	});
});
