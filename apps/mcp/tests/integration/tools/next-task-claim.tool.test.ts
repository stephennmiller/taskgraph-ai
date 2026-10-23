/**
 * @fileoverview next_task with claim: true on the built server: it starts the
 * task and records the claim, a second claim gets another task, and plain
 * next_task still writes nothing.
 *
 * @integration
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callMCPTool } from '../../helpers/call-mcp-tool.js';

describe('next_task MCP tool with claim', () => {
	let testDir: string;
	let tasksPath: string;

	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks as Array<{
			id: number | string;
			status: string;
			metadata?: Record<string, unknown>;
		}>;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-claim-'));
		process.chdir(testDir);
		const cliPath = path.resolve(__dirname, '../../../../../dist/taskgraph.js');
		execFileSync(process.execPath, [cliPath, 'init', '--yes'], {
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		fs.writeFileSync(
			tasksPath,
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({ id: 1, title: 'First', priority: 'high' }),
						createTask({ id: 2, title: 'Second', priority: 'medium' })
					]
				}),
				null,
				2
			)
		);
		// Starting the built CLI for init can take over 15s on a busy machine
	}, 60000);

	afterEach(() => {
		try {
			process.chdir(path.resolve(__dirname, '../../../../..'));
		} catch {
			process.chdir(os.homedir());
		}
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('starts the next task and records who claimed it', () => {
		const reply = callMCPTool('next_task', {
			projectRoot: testDir,
			claim: true
		});

		expect(reply.data.nextTask).toMatchObject({
			id: '1',
			title: 'First',
			status: 'in-progress'
		});
		expect(reply.data.claimedBy).toEqual(expect.any(String));
		const [first] = readTasks();
		expect(first.status).toBe('in-progress');
		expect(first.metadata).toMatchObject({
			claimedBy: reply.data.claimedBy,
			claimedAt: reply.data.claimedAt
		});
	}, 30000);

	it('gives a second claim the next task, then reports nothing ready', () => {
		callMCPTool('next_task', { projectRoot: testDir, claim: true });

		const second = callMCPTool('next_task', {
			projectRoot: testDir,
			claim: true
		});
		const third = callMCPTool('next_task', {
			projectRoot: testDir,
			claim: true
		});

		expect(second.data.nextTask.id).toBe('2');
		expect(third.data.nextTask).toBeNull();
		expect(third.data.message).toMatch(/No task is ready to claim/);
	}, 45000);

	it('writes nothing without claim', () => {
		const before = fs.readFileSync(tasksPath, 'utf8');

		const reply = callMCPTool('next_task', { projectRoot: testDir });

		expect(reply.data.nextTask.id).toBe(1);
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	}, 30000);
});
