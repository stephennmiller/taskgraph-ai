/**
 * @fileoverview completePhase must reject test results that cannot be
 * trusted: counts that do not add up, or a GREEN run with no tests at all.
 *
 * @integration
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/common/logger/index.js', () => ({
	getLogger: () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		child: vi.fn().mockReturnThis()
	})
}));

import { WorkflowService } from '../../../src/modules/workflow/services/workflow.service.js';
import { createWorkflowProject } from './project-helper.js';

describe('Autopilot test result validation', () => {
	let project: ReturnType<typeof createWorkflowProject>;
	let service: WorkflowService;

	const red = {
		total: 2,
		passed: 0,
		failed: 2,
		skipped: 0,
		phase: 'RED'
	} as const;

	beforeEach(async () => {
		project = createWorkflowProject();
		service = new WorkflowService(project.projectDir);
		await service.startWorkflow({
			taskId: '1',
			taskTitle: 'Validation',
			subtasks: [{ id: '1', title: 'Only', status: 'pending' }]
		});
	});

	afterEach(() => project.restore());

	it('rejects results whose counts do not add up', async () => {
		await expect(service.completePhase({ ...red, total: 9 })).rejects.toThrow(
			/passed \+ failed \+ skipped/
		);
		expect(service.getStatus().tddPhase).toBe('RED');
	});

	it('rejects an empty RED run', async () => {
		await expect(
			service.completePhase({
				total: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				phase: 'RED'
			})
		).rejects.toThrow(/empty|test/i);
	});

	it('rejects a GREEN run that ran no tests', async () => {
		await service.completePhase(red);

		await expect(
			service.completePhase({
				total: 0,
				passed: 0,
				failed: 0,
				skipped: 0,
				phase: 'GREEN'
			})
		).rejects.toThrow(/at least one passing test/);
		expect(service.getStatus().tddPhase).toBe('GREEN');
	});

	it('still lets a real GREEN run through', async () => {
		await service.completePhase(red);

		const status = await service.completePhase({
			total: 2,
			passed: 2,
			failed: 0,
			skipped: 0,
			phase: 'GREEN'
		});

		expect(status.tddPhase).toBe('COMMIT');
	});
});
