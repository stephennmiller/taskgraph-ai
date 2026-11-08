import { describe, expect, it } from 'vitest';
import type { TaskStatus } from '../../../common/types/index.js';
import { createSubtask, createTask } from '../../../testing/index.js';
import { withParentStatus } from './parent-status.js';

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
