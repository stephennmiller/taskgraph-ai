/**
 * @fileoverview The task list numbers subtasks 1, 2, ... A finished subtask
 * must be marked done as "5.1", not as task 1.
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

import fs from 'node:fs';
import { WorkflowStateManager } from '../../../src/modules/workflow/managers/workflow-state-manager.js';
import { createWorkflowProject } from './project-helper.js';

describe('Autopilot subtask ids', () => {
	let project: ReturnType<typeof createWorkflowProject>;
	let projectDir: string;

	beforeEach(() => {
		project = createWorkflowProject();
		projectDir = project.projectDir;
	});

	afterEach(() => project.restore());

	it('marks the subtask done by its full id, not the task with the same number', async () => {
		const updateStatus = vi.fn().mockResolvedValue(undefined);
		const service = new WorkflowService({
			projectRoot: projectDir,
			taskStatusUpdater: { updateStatus }
		});
		await service.startWorkflow({
			taskId: '5',
			taskTitle: 'Qualified ids',
			subtasks: [
				{ id: '1', title: 'First', status: 'pending' },
				{ id: '2', title: 'Second', status: 'pending' }
			]
		});
		await service.completePhase({
			total: 1,
			passed: 0,
			failed: 1,
			skipped: 0,
			phase: 'RED'
		});
		await service.completePhase({
			total: 1,
			passed: 1,
			failed: 0,
			skipped: 0,
			phase: 'GREEN'
		});

		const status = await service.commit();

		expect(updateStatus).toHaveBeenCalledWith('5.1', 'done', undefined);
		expect(updateStatus).not.toHaveBeenCalledWith('1', 'done', undefined);
		expect(status.currentSubtask?.id).toBe('5.2');
	});

	it('qualifies the ids of a workflow saved with bare ones when it resumes', async () => {
		const service = new WorkflowService(projectDir);
		await service.startWorkflow({
			taskId: '5',
			taskTitle: 'Old state',
			subtasks: [{ id: '1', title: 'First', status: 'pending' }]
		});
		const statePath = new WorkflowStateManager(projectDir).getStatePath();
		const saved = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
		saved.context.subtasks[0].id = '1';
		fs.writeFileSync(statePath, JSON.stringify(saved));

		const status = await new WorkflowService(projectDir).resumeWorkflow();

		expect(status.currentSubtask?.id).toBe('5.1');
	});
});
