/**
 * MCP progress for parse-prd when the model sizes the task list (numTasks 0,
 * the default since #253): no total, no "N/0", no Infinity token estimate
 */
import { describe, expect, it, vi } from 'vitest';
import { reportTaskProgress } from '../../../../../scripts/modules/task-manager/parse-prd/parse-prd-helpers.js';

const report = (totalTasks: number) => {
	const reportProgress = vi.fn();
	reportTaskProgress({
		task: { title: 'Set up the database', priority: 'high' },
		currentCount: 3,
		totalTasks,
		estimatedTokens: 1200,
		progressTracker: null,
		reportProgress,
		priorityMap: { high: 'H', medium: 'M', low: 'L' },
		defaultPriority: 'medium',
		estimatedInputTokens: 500
	});
	return reportProgress.mock.calls[0][0];
};

describe('reportTaskProgress', () => {
	it('omits the total when the model sizes the list', () => {
		const update = report(0);

		expect(update).toEqual({
			progress: 3,
			message: 'H Task 3 - Set up the database'
		});
		expect(update.message).not.toMatch(/Infinity|\/0/);
	});

	it('reports the total and a per-task token estimate when a count is set', () => {
		const update = report(4);

		expect(update).toEqual({
			progress: 3,
			total: 4,
			message: 'H Task 3/4 - Set up the database | ~Output: 300 tokens'
		});
	});
});
