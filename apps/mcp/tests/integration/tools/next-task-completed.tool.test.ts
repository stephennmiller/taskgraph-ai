/**
 * @fileoverview next_task on the built server reads the older 'completed'
 * status as 'done', so it offers the same task as `taskgraph next` (#247)
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

describe("next_task MCP tool with a top-level 'completed' task", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-completed-'));
		process.chdir(testDir);
		const cliPath = path.resolve(__dirname, '../../../../../dist/taskgraph.js');
		execFileSync(process.execPath, [cliPath, 'init', '--yes'], {
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});
		fs.writeFileSync(
			path.join(testDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({
							id: 1,
							title: 'Set up the database',
							status: 'completed' as never, // the older spelling, as an old file has it
							priority: 'high'
						}),
						createTask({
							id: 2,
							title: 'Build the login API',
							priority: 'medium',
							dependencies: ['1']
						})
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

	it('offers the task that depends on it, as taskgraph next does', () => {
		const reply = callMCPTool('next_task', { projectRoot: testDir });

		expect(reply.data.nextTask.id).toBe(2);
	}, 30000);
});
