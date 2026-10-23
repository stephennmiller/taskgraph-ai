import { stripVTControlCharacters } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
	formatStartFailed,
	formatStartLaunching,
	formatStartSessionEnded
} from './start-formatters.js';

const plain = (text: string) => stripVTControlCharacters(text);

describe('formatStartLaunching', () => {
	it('names the subtask being started, then the launch', () => {
		const out = plain(
			formatStartLaunching(
				{ id: '2.2', kind: 'subtask' },
				'Sessions table and cookie middleware',
				80
			)
		);

		expect(out).toBe(
			'▶ Starting subtask 2.2  Sessions table and cookie middleware\nLaunching Claude Code…\n'
		);
	});

	it('cuts a long title to the width', () => {
		const out = plain(
			formatStartLaunching({ id: '3', kind: 'task' }, 'x'.repeat(200), 50)
		);

		expect(out.split('\n')[0]).toHaveLength(50);
		expect(out.split('\n')[0].endsWith('…')).toBe(true);
	});
});

describe('formatStartSessionEnded', () => {
	it('ends with one next step: mark the work done', () => {
		const out = plain(formatStartSessionEnded('2.2', 80)).trim().split('\n');

		expect(out).toEqual([
			'✓ Claude Code session ended',
			'Next: taskgraph set-status --id=2.2 --status=done when it is finished'
		]);
	});
});

describe('formatStartFailed', () => {
	it('explains a conflict and offers --force', () => {
		const failure = formatStartFailed('3', {
			found: false,
			error: 'Conflicting tasks in progress: #2: Sign-in'
		});

		expect(failure.message).toBe('Another task is in progress: #2: Sign-in');
		expect(failure.hint).toBe(
			'Run `taskgraph start 3 --force` to start it anyway'
		);
	});

	it('says a missing task is missing, not just "not found!"', () => {
		const failure = formatStartFailed('99', {
			found: false,
			error: 'Task 99 not found'
		});

		expect(failure.message).toBe('Task 99 not found');
		expect(failure.hint).toContain('taskgraph list');
	});

	it('points at the claude command when the launch could not be prepared', () => {
		const failure = formatStartFailed('3', { found: true });

		expect(failure.message).toBe("Couldn't launch Claude Code for 3");
		expect(failure.hint).toContain('claude');
	});
});
