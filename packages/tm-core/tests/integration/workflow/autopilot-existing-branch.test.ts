/**
 * @fileoverview Starting a workflow whose branch already exists (left by an
 * earlier run) must fail clearly and leave no saved state behind, so the
 * next start is not blocked.
 *
 * @integration
 */

import { execSync } from 'node:child_process';
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

describe('Autopilot start when the branch already exists', () => {
	let project: ReturnType<typeof createWorkflowProject>;

	const start = (service: WorkflowService, force = false) =>
		service.startWorkflow({
			taskId: '7',
			taskTitle: 'Reuse branch',
			force,
			subtasks: [{ id: '1', title: 'Only', status: 'pending' }]
		});
	const branch = () =>
		execSync('git branch --show-current', {
			cwd: project.projectDir,
			encoding: 'utf8'
		}).trim();

	beforeEach(() => {
		project = createWorkflowProject();
	});

	afterEach(() => project.restore());

	it('says the branch is left over and leaves no half-started workflow', async () => {
		await start(new WorkflowService(project.projectDir));
		const workflowBranch = branch();
		execSync('git checkout -', { cwd: project.projectDir, stdio: 'pipe' });
		const retry = new WorkflowService(project.projectDir);

		await expect(start(retry, true)).rejects.toThrow(/already exists/);

		expect(await retry.hasWorkflow()).toBe(false);
		expect(branch()).not.toBe(workflowBranch);
	});

	it('starts normally when already on that branch', async () => {
		await start(new WorkflowService(project.projectDir));
		const retry = new WorkflowService(project.projectDir);

		const status = await start(retry, true);

		expect(status.tddPhase).toBe('RED');
	});
});
