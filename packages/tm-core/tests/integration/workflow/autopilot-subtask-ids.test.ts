/**
 * @fileoverview The task list numbers subtasks 1, 2, ... A finished subtask
 * must be marked done as "5.1", not as task 1.
 *
 * @integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

const originalHome = process.env.HOME;

describe('Autopilot subtask ids', () => {
	let projectDir: string;
	let homeDir: string;

	beforeEach(() => {
		homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ids-home-'));
		projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-ids-project-'));
		// Keep workflow state out of the real ~/.taskgraph
		process.env.HOME = homeDir;
		const git = (cmd: string) =>
			execSync(cmd, { cwd: projectDir, stdio: 'pipe' });
		git('git init');
		git('git config user.email "test@test.com"');
		git('git config user.name "Test User"');
		git('git config commit.gpgsign false');
		fs.writeFileSync(path.join(projectDir, 'README.md'), '# Test\n');
		git('git add .');
		git('git commit -m "Initial commit"');
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		fs.rmSync(projectDir, { recursive: true, force: true });
		fs.rmSync(homeDir, { recursive: true, force: true });
	});

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
});
