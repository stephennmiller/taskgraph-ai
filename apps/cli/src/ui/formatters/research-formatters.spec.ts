import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatResearchAnswer,
	formatResearchContext,
	formatResearchSaveFailed,
	formatResearchSaved,
	sortTaskIds
} from './research-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);

describe('formatResearchContext', () => {
	it('lists the tasks you asked for, then related ones', () => {
		const line = formatResearchContext({
			taskIds: ['3'],
			relatedTaskIds: ['6', '1', '2'],
			files: []
		});

		expect(plain(line)).toBe('Context: task 3 · related 1, 2, 6');
	});

	it('names related tasks as tasks when you asked for none', () => {
		const line = formatResearchContext({
			taskIds: [],
			relatedTaskIds: ['4'],
			files: []
		});

		expect(plain(line)).toBe('Context: related task 4');
	});

	it('names up to two files, counts more, and adds the tree and notes', () => {
		const two = formatResearchContext({
			taskIds: ['1', '2'],
			relatedTaskIds: [],
			files: ['src/db.ts', 'README.md'],
			projectTree: true,
			customContext: true
		});
		const three = formatResearchContext({
			taskIds: [],
			relatedTaskIds: [],
			files: ['a.ts', 'b.ts', 'c.ts']
		});

		expect(plain(two)).toBe(
			'Context: tasks 1, 2 · src/db.ts, README.md · project tree · your notes'
		);
		expect(plain(three)).toBe('Context: 3 files');
	});

	it('prints nothing when there is no project context', () => {
		expect(
			formatResearchContext({ taskIds: [], relatedTaskIds: [], files: [] })
		).toBe('');
	});
});

describe('sortTaskIds', () => {
	it('sorts tasks and subtasks numerically', () => {
		expect(sortTaskIds(['10', '2', '3.10', '3.2', '3'])).toEqual([
			'2',
			'3',
			'3.2',
			'3.10',
			'10'
		]);
	});
});

describe('formatResearchSaved / formatResearchSaveFailed', () => {
	it('says where the answer went', () => {
		expect(plain(formatResearchSaved({ kind: 'task', id: '3' }))).toBe(
			'✓ Saved to task 3'
		);
		expect(plain(formatResearchSaved({ kind: 'task', id: '3.2' }))).toBe(
			'✓ Saved to subtask 3.2'
		);
		expect(
			plain(formatResearchSaved({ kind: 'file', path: 'notes/sessions.md' }))
		).toBe('✓ Saved to notes/sessions.md');
	});

	it('says why saving failed', () => {
		expect(
			plain(
				formatResearchSaveFailed(
					{ kind: 'task', id: '9' },
					"Task 9 doesn't exist"
				)
			)
		).toBe("✗ Couldn't save to task 9: Task 9 doesn't exist");
	});
});

describe('formatResearchAnswer', () => {
	const answer = [
		'## Storing sessions',
		'',
		'Use **`connect-pg-simple`** with the pool you already have.',
		'',
		'- **Pin the version**: versions before 6.0.1 had a SQL injection risk if `tableName` came from untrusted input, so use a current one.',
		'- **`resave: false`** avoids writes on every request.',
		'',
		'```ts',
		'app.use(session({ store }));',
		'```'
	].join('\n');

	it('renders inline markdown inside list items', () => {
		const output = plain(formatResearchAnswer(answer, 80));

		expect(output).toContain('• Pin the version: versions before 6.0.1');
		expect(output).toContain('• resave: false avoids writes');
		expect(output).not.toContain('**');
		expect(output).not.toContain('`');
	});

	it('wraps long list items with a hanging indent', () => {
		const lines = plain(formatResearchAnswer(answer, 60)).split('\n');
		const first = lines.findIndex((line) => line.includes('Pin the version'));

		expect(lines[first].length).toBeLessThanOrEqual(60);
		expect(lines[first + 1]).toMatch(/^ {4}\S/);
	});

	it('keeps every prose line within the terminal width', () => {
		for (const line of plain(formatResearchAnswer(answer, 50)).split('\n')) {
			expect(line.length).toBeLessThanOrEqual(50);
		}
	});

	it('stops at 100 columns on wide terminals', () => {
		const long = `${'word '.repeat(60).trim()}.`;
		const lines = plain(formatResearchAnswer(long, 200)).split('\n');

		expect(lines.length).toBeGreaterThan(1);
		expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
			100
		);
	});

	it('drops <think> reasoning', () => {
		const output = plain(
			formatResearchAnswer('<think>internal notes</think>The answer.', 80)
		);

		expect(output).toBe('The answer.');
	});
});
