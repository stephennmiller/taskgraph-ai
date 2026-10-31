import { describe, expect, it, vi } from 'vitest';
import type { Subtask, Task } from '../../../common/types/index.js';
import { appendNote } from '../utils/notes.js';
import { keptSubtaskIds, mergeRewrite } from './update-task-helpers.js';

const AT = '2026-10-25T00:00:00.000Z';
const NOTE = `<info added on ${AT}>\nfound X\n</info added on ${AT}>`;

function task(fields: Partial<Task> = {}): Task {
	return {
		id: '3',
		title: 'Old',
		description: 'Desc',
		status: 'pending',
		priority: 'medium',
		dependencies: [],
		subtasks: [],
		details: 'Old details',
		testStrategy: '',
		...fields
	} as Task;
}

describe('mergeRewrite: details appended during the AI call', () => {
	it('keeps a note after the AI details', () => {
		const stored = task();
		const now = task({ details: appendNote(stored.details, 'found X', AT) });
		const warn = vi.fn();

		const merged = mergeRewrite(
			stored,
			task({ details: 'New details' }),
			now,
			warn
		);

		expect(merged.details).toBe(`New details\n${NOTE}`);
		expect(warn).not.toHaveBeenCalled();
	});

	it('keeps a note added to empty details', () => {
		const stored = task({ details: undefined });
		const now = task({ details: appendNote(undefined, 'found X', AT) });

		const merged = mergeRewrite(
			stored,
			task({ details: 'New details' }),
			now,
			vi.fn()
		);

		expect(merged.details).toBe(`New details\n${NOTE}`);
	});

	it('keeps the note when the AI left details unchanged', () => {
		const stored = task();
		const now = task({ details: appendNote(stored.details, 'found X', AT) });

		const merged = mergeRewrite(stored, task(), now, vi.fn());

		expect(merged.details).toBe(now.details);
	});

	it('keeps the note when the AI left out details the task had none of', () => {
		const { details: _, ...stored } = task();
		const now = task({ details: NOTE });

		const merged = mergeRewrite(stored as Task, stored as Task, now, vi.fn());

		expect(merged.details).toBe(NOTE);
	});

	it('does not start the details with a blank line when the AI emptied them', () => {
		const stored = task();
		const now = task({ details: appendNote(stored.details, 'found X', AT) });

		const merged = mergeRewrite(stored, task({ details: '' }), now, vi.fn());

		expect(merged.details).toBe(NOTE);
	});

	it('warns and saves the AI details when the details were edited, not appended', () => {
		const stored = task();
		const now = task({ details: `Edited\n${NOTE}` });
		const warn = vi.fn();

		const merged = mergeRewrite(
			stored,
			task({ details: 'New details' }),
			now,
			warn
		);

		expect(merged.details).toBe('New details');
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('details'));
	});
});

describe('keptSubtaskIds', () => {
	it('gives a new subtask the next whole number, past a dotted ID left as is', () => {
		const original = [{ id: '1' }, { id: '3.1' }] as Subtask[];

		const ids = keptSubtaskIds(original, [original[1], undefined], 2);

		expect(ids).toEqual(['3.1', '2']);
	});
});
