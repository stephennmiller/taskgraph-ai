/**
 * @fileoverview Regression tests for #268: six MCP tools passed a name string
 * to withToolContext (which takes only the function) and failed on every call.
 * Each tool is called through the built server; a guard test checks that no
 * tool file passes a non-function to withToolContext.
 *
 * Needs the build (`npm run build`).
 *
 * @integration
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { callMCPTool } from '../../helpers/call-mcp-tool.js';

const repoRoot = path.resolve(__dirname, '../../../../..');

describe('tools wrapped in withToolContext (#268)', () => {
	let testDir: string;
	let tasksPath: string;

	const readTasks = () =>
		JSON.parse(fs.readFileSync(tasksPath, 'utf8')).master.tasks;
	const writeTasks = (tasks: unknown[]) =>
		fs.writeFileSync(
			tasksPath,
			JSON.stringify(createTasksFile({ tasks: tasks as any }), null, 2)
		);

	// `init` runs as a child process and can take over 10s on a busy CI
	// runner while other test files spawn servers, so allow it 30s
	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-mcp-ctx-'));
		process.chdir(testDir);
		execSync(
			`node "${path.join(repoRoot, 'dist', 'taskgraph.js')}" init --yes`,
			{
				stdio: 'pipe',
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			}
		);
		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		writeTasks([
			createTask({ id: 1, title: 'One' }),
			createTask({ id: 2, title: 'Two' })
		]);
	}, 30_000);

	afterEach(() => {
		process.chdir(repoRoot);
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	it('add_dependency adds the dependency', () => {
		callMCPTool('add_dependency', {
			id: '2',
			dependsOn: '1',
			projectRoot: testDir
		});
		expect(readTasks()[1].dependencies.map(String)).toEqual(['1']);
	}, 30000);

	it('remove_dependency removes the dependency', () => {
		writeTasks([
			createTask({ id: 1, title: 'One' }),
			createTask({ id: 2, title: 'Two', dependencies: ['1'] })
		]);
		callMCPTool('remove_dependency', {
			id: '2',
			dependsOn: '1',
			projectRoot: testDir
		});
		expect(readTasks()[1].dependencies).toEqual([]);
	}, 30000);

	it('validate_dependencies reports a missing task and changes nothing', () => {
		writeTasks([
			createTask({ id: 1, title: 'One', dependencies: ['99'] }),
			createTask({ id: 2, title: 'Two' })
		]);
		const before = fs.readFileSync(tasksPath, 'utf8');
		const out = callMCPTool('validate_dependencies', { projectRoot: testDir });
		expect(out.data.valid).toBe(false);
		expect(out.data.issues).toHaveLength(1);
		expect(fs.readFileSync(tasksPath, 'utf8')).toBe(before);
	}, 30000);

	it('fix_dependencies drops a dependency on a missing task', () => {
		writeTasks([
			createTask({ id: 1, title: 'One', dependencies: ['99'] }),
			createTask({ id: 2, title: 'Two' })
		]);
		callMCPTool('fix_dependencies', { projectRoot: testDir });
		expect(readTasks()[0].dependencies).toEqual([]);
	}, 30000);

	it('clear_subtasks empties the subtasks', () => {
		writeTasks([
			createTask({
				id: 1,
				title: 'One',
				subtasks: [
					{
						id: 1,
						title: 'Sub',
						description: 'Sub',
						status: 'pending',
						dependencies: []
					} as any
				]
			}),
			createTask({ id: 2, title: 'Two' })
		]);
		callMCPTool('clear_subtasks', { id: '1', projectRoot: testDir });
		expect(readTasks()[0].subtasks).toEqual([]);
	}, 30000);

	it('models replies with the configured models', () => {
		const out = callMCPTool('models', { projectRoot: testDir });
		expect(typeof out.data.activeModels.main.modelId).toBe('string');
	}, 30000);
});

describe('withToolContext callers', () => {
	it('no tool passes a non-function as the first argument', () => {
		// Both wrappers take only the function; anything else first (a name, a
		// variable) fails every call at runtime. Skip the definition itself.
		const wrongFirstArgument =
			/(?<!function\s)\b(?:withToolContext|withNormalizedProjectRoot)\(\s*(?!\s|async\b|function\b|\()/;
		const root = path.join(repoRoot, 'mcp-server', 'src');
		const offenders = (
			fs.readdirSync(root, { recursive: true }) as string[]
		).filter(
			(f) =>
				f.endsWith('.js') &&
				wrongFirstArgument.test(fs.readFileSync(path.join(root, f), 'utf8'))
		);
		expect(offenders).toEqual([]);
	});
});
