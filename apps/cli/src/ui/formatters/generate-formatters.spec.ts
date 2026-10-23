import { describe, expect, it } from 'vitest';
import {
	formatGenerateError,
	formatGenerateResult
} from './generate-formatters.js';

const plain = (text: string) => text.replace(/\x1b\[[0-9;]*m/g, '');
const root = '/home/me/project';
const result = (overrides = {}) => ({
	success: true,
	count: 3,
	directory: `${root}/.taskgraph/tasks`,
	orphanedFilesRemoved: 0,
	...overrides
});

describe('formatGenerateResult', () => {
	it('confirms in one line with the folder relative to the project', () => {
		expect(plain(formatGenerateResult(result(), root))).toBe(
			'✓ Generated 3 task files in .taskgraph/tasks'
		);
	});

	it('adds the orphaned files it removed to the same line', () => {
		expect(
			plain(
				formatGenerateResult(
					result({ count: 1, orphanedFilesRemoved: 2 }),
					root
				)
			)
		).toBe(
			'✓ Generated 1 task file in .taskgraph/tasks · removed 2 orphaned files'
		);
	});

	it('fits 80 columns for a typical run', () => {
		const line = plain(
			formatGenerateResult(
				result({ count: 120, orphanedFilesRemoved: 12 }),
				root
			)
		);
		expect(line.length).toBeLessThanOrEqual(80);
	});

	it('keeps an absolute path for a folder outside the project', () => {
		expect(
			plain(formatGenerateResult(result({ directory: '/tmp/out' }), root))
		).toBe('✓ Generated 3 task files in /tmp/out');
	});

	it('says how to add a task when there are none', () => {
		expect(plain(formatGenerateResult(result({ count: 0 }), root))).toBe(
			'No tasks to generate files for; add one with taskgraph add-task'
		);
	});
});

describe('formatGenerateError', () => {
	it('passes on the reason generation failed', () => {
		expect(
			formatGenerateError(
				result({
					success: false,
					count: 0,
					error: 'EEXIST: file already exists'
				}),
				root
			)
		).toEqual({
			message: "Couldn't generate task files: EEXIST: file already exists",
			hint: 'Run `taskgraph list` to check that the tasks file reads'
		});
	});

	it('names the first file it could not write and counts the rest', () => {
		const { message, hint } = formatGenerateError(
			result({
				success: false,
				count: 1,
				fileErrors: { '2': 'EACCES: permission denied', '3': 'EACCES' }
			}),
			root
		);

		expect(message).toBe(
			"Couldn't write 2 task files to .taskgraph/tasks: task 2: EACCES: permission denied (and 1 more)"
		);
		expect(hint).toContain('.taskgraph/tasks is writable');
	});
});
