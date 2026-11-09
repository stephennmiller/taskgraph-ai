import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/index.js';
import {
	settleChangedParents,
	subtaskShapes,
	withParentStatus
} from './parent-status.js';

const parent = (status: TaskStatus, ...subs: TaskStatus[]) => ({
	...createTask({
		id: '1',
		title: 'Parent',
		status,
		subtasks: subs.map((s, i) =>
			createSubtask({ id: i + 1, title: `Sub ${i + 1}`, status: s })
		)
	}),
	metadata: { claimedBy: 'alice' }
});

describe('withParentStatus', () => {
	it('reopens a done parent whose subtasks are all new, as expand on a done task makes it (#1042)', () => {
		const settled = withParentStatus(parent('done', 'pending', 'pending'));

		expect(settled.status).toBe('in-progress');
		expect(settled.metadata).toEqual({ claimedBy: 'alice' });
	});

	it('keeps a claimed parent in progress when it gains pending subtasks, resetting only on request', () => {
		const claimed = parent('in-progress', 'pending', 'pending');

		expect(withParentStatus(claimed)).toBe(claimed);
		const reset = withParentStatus(claimed, undefined, true);
		expect(reset.status).toBe('pending');
		expect(reset.metadata).toBeUndefined();
	});

	it('leaves a parent without subtasks, or with all cancelled, as it is', () => {
		const empty = parent('in-progress');
		const cancelled = parent('pending', 'cancelled');

		expect(withParentStatus(empty)).toBe(empty);
		expect(withParentStatus(cancelled)).toBe(cancelled);
	});
});

it('leaves a parent the user held back as it is when only the subtask list changes', () => {
	for (const held of ['blocked', 'deferred', 'cancelled', 'review'] as const) {
		const started = parent(held, 'done', 'pending');
		const finished = parent(held, 'done', 'done');

		expect(withParentStatus(started)).toBe(started);
		expect(withParentStatus(finished)).toBe(finished);
	}
	// A subtask's own status change still moves it, as set-status always did
	expect(
		withParentStatus(parent('blocked', 'in-progress'), undefined, true).status
	).toBe('in-progress');
});

describe('settleChangedParents', () => {
	it('counts a status change on the same subtasks as the subtask moving the parent', () => {
		const tasks = [parent('review', 'done', 'pending')];
		const before = subtaskShapes(tasks);
		tasks[0].subtasks[1].status = 'done';

		settleChangedParents(before, tasks);

		// set-status would finish it; a review parent stays in review
		expect(tasks[0].status).toBe('review');
		tasks[0].status = 'blocked';
		const blocked = subtaskShapes(tasks);
		tasks[0].subtasks[1].status = 'in-progress';
		settleChangedParents(blocked, tasks);
		expect(tasks[0].status).toBe('in-progress');
	});

	it('treats new subtasks under reused IDs (expand --force) as a list change', () => {
		const tasks = [parent('in-progress', 'done', 'done')];
		const before = subtaskShapes(tasks);
		tasks[0].subtasks = parent('pending', 'pending', 'pending').subtasks.map(
			(s) => ({ ...s, title: `New ${s.id}` })
		);

		settleChangedParents(before, tasks);

		// Only set-status sets a parent back to pending
		expect(tasks[0].status).toBe('in-progress');
		expect(tasks[0].metadata).toEqual({ claimedBy: 'alice' });
	});

	it('leaves a task the write added, and settles in place', () => {
		const added = parent('done', 'pending');
		const kept = parent('in-progress', 'done', 'pending');
		const before = subtaskShapes([kept]);
		kept.subtasks.pop();

		settleChangedParents(before, [kept, { ...added, id: '2' }]);

		expect(kept.status).toBe('done');
		expect(added.status).toBe('done');
	});
});
