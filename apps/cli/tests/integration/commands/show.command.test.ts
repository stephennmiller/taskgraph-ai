/**
 * @fileoverview Integration tests for 'taskgraph show' command
 *
 * Tests the show command which displays detailed information about a specific task.
 *
 * @integration
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSubtask, createTask, createTasksFile } from '@tm/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCliBinPath } from '../../helpers/test-utils.js';

// Capture initial working directory at module load time
const initialCwd = process.cwd();

describe('show command', () => {
	let testDir: string;
	let tasksPath: string;
	let binPath: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-show-test-'));
		process.chdir(testDir);
		process.env.TASKGRAPH_SKIP_AUTO_UPDATE = '1';

		binPath = getCliBinPath();

		execSync(`node "${binPath}" init --yes`, {
			stdio: 'pipe',
			env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
		});

		tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');

		// Use fixture to create initial empty tasks file
		const initialTasks = createTasksFile();
		fs.writeFileSync(tasksPath, JSON.stringify(initialTasks, null, 2));
	});

	afterEach(() => {
		try {
			// Restore to the original working directory captured at module load
			process.chdir(initialCwd);
		} catch {
			// Fallback to home directory if initial directory no longer exists
			process.chdir(os.homedir());
		}

		if (testDir && fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}

		delete process.env.TASKGRAPH_SKIP_AUTO_UPDATE;
	});

	const writeTasks = (tasksData: any) => {
		fs.writeFileSync(tasksPath, JSON.stringify(tasksData, null, 2));
	};

	const runShow = (taskId: string): { output: string; exitCode: number } => {
		try {
			const output = execSync(`node "${binPath}" show ${taskId}`, {
				encoding: 'utf-8',
				stdio: 'pipe',
				env: { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' }
			});
			return { output, exitCode: 0 };
		} catch (error: any) {
			// For errors, prioritize stderr (where error messages go)
			return {
				output: error.stderr?.toString() || error.stdout?.toString() || '',
				exitCode: error.status || 1
			};
		}
	};

	it('should display complete task details', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Detailed Task',
					description: 'A comprehensive task description',
					status: 'pending',
					priority: 'high',
					details: 'Implementation details go here',
					testStrategy: 'Unit tests and integration tests'
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runShow('1');

		expect(exitCode).toBe(0);
		expect(output).toContain('Detailed Task');
		expect(output).toContain('A comprehensive task description');
		expect(output).toContain('pending');
		expect(output).toContain('high');
		expect(output).toContain('Implementation details');
		expect(output).toContain('Unit tests and integration tests');
	});

	it('should show task with dependencies', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'First Task', status: 'done' }),
				createTask({
					id: 2,
					title: 'Second Task',
					description: 'Depends on task 1',
					status: 'pending',
					dependencies: ['1']
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runShow('2');

		expect(exitCode).toBe(0);
		expect(output).toContain('Second Task');
		expect(output).toContain('Depends on task 1');
	});

	it('should show task with subtasks', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Parent Task',
					description: 'Task with multiple subtasks',
					status: 'in-progress',
					subtasks: [
						createSubtask({
							id: '1.1',
							title: 'Setup Phase',
							description: 'Initial setup',
							status: 'done',
							parentId: '1'
						}),
						createSubtask({
							id: '1.2',
							title: 'Implementation Phase',
							description: 'Build feature',
							status: 'in-progress',
							dependencies: ['1.1'],
							parentId: '1'
						}),
						createSubtask({
							id: '1.3',
							title: 'Testing Phase',
							description: 'Write tests',
							status: 'pending',
							dependencies: ['1.2'],
							parentId: '1'
						})
					]
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runShow('1');

		expect(exitCode).toBe(0);
		expect(output).toContain('Parent Task');
		expect(output).toContain('Setup Phase');
		expect(output).toContain('Implementation Phase');
		expect(output).toContain('Testing Phase');
	});

	it('should show minimal task information', () => {
		const testData = createTasksFile({
			tasks: [createTask({ id: 1, title: 'Simple Task', status: 'pending' })]
		});
		writeTasks(testData);

		const { output, exitCode } = runShow('1');

		expect(exitCode).toBe(0);
		expect(output).toContain('Simple Task');
		expect(output).toContain('pending');
	});

	it('should show task with all status types', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'Done Task', status: 'done' }),
				createTask({ id: 2, title: 'Pending Task', status: 'pending' }),
				createTask({ id: 3, title: 'In Progress', status: 'in-progress' }),
				createTask({ id: 4, title: 'Review Task', status: 'review' })
			]
		});
		writeTasks(testData);

		// Test each status
		let result = runShow('1');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('Done Task');

		result = runShow('2');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('Pending Task');

		result = runShow('3');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('In Progress');

		result = runShow('4');
		expect(result.exitCode).toBe(0);
		expect(result.output).toContain('Review Task');
	});

	it('should show task with priority levels', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'High Priority',
					status: 'pending',
					priority: 'high'
				}),
				createTask({
					id: 2,
					title: 'Medium Priority',
					status: 'pending',
					priority: 'medium'
				}),
				createTask({
					id: 3,
					title: 'Low Priority',
					status: 'pending',
					priority: 'low'
				})
			]
		});
		writeTasks(testData);

		let result = runShow('1');
		expect(result.output).toContain('High Priority');
		expect(result.output).toContain('high');

		result = runShow('2');
		expect(result.output).toContain('Medium Priority');
		expect(result.output).toContain('medium');

		result = runShow('3');
		expect(result.output).toContain('Low Priority');
		expect(result.output).toContain('low');
	});
});

describe('show command output', () => {
	let testDir: string;
	let binPath: string;

	const env = { ...process.env, TASKGRAPH_SKIP_AUTO_UPDATE: '1' };

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-show-output-'));
		binPath = getCliBinPath();
		execSync(`node "${binPath}" init --yes`, {
			cwd: testDir,
			stdio: 'pipe',
			env
		});
		fs.writeFileSync(
			path.join(testDir, '.taskgraph', 'tasks', 'tasks.json'),
			JSON.stringify(
				createTasksFile({
					tasks: [
						createTask({
							id: 1,
							title: 'Set up the database schema',
							status: 'done'
						}),
						createTask({
							id: 2,
							title: 'Email and password sign-in with sessions',
							description:
								'Let people create an account with an email and password, sign in, and stay signed in across browser restarts.',
							status: 'in-progress',
							priority: 'high',
							dependencies: ['1'],
							details:
								'Hash passwords with bcrypt (cost 12). Store sessions in the sessions table with a 30-day sliding expiry.',
							subtasks: [
								createSubtask({
									id: 1,
									parentId: '2',
									title: 'Password hashing helpers',
									status: 'done'
								}),
								createSubtask({
									id: 2,
									parentId: '2',
									title: 'Sessions table and cookie middleware',
									description: '',
									dependencies: [1]
								})
							]
						})
					]
				}),
				null,
				2
			)
		);
	});

	afterEach(() => {
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	const show = (...args: string[]) =>
		spawnSync(process.execPath, [binPath, 'show', ...args], {
			cwd: testDir,
			encoding: 'utf8',
			env
		});

	it('prints headed sections and one next step, with no boxes, within 80 columns', () => {
		const res = show('2');
		const lines = res.stdout.split('\n');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'Task 2  Email and password sign-in with sessions'
		);
		expect(res.stdout).toContain(
			'▶ in-progress · high priority · depends on 1'
		);
		expect(res.stdout).toContain('\nDetails\n  Hash passwords with bcrypt');
		expect(res.stdout).toContain('Subtasks · 1 of 2 done');
		expect(res.stdout).toContain(
			'  2.2  ○ pending  Sessions table and cookie middleware  after 2.1'
		);
		expect(lines.filter((line) => line.startsWith('Next: '))).toHaveLength(1);
		expect(res.stdout).not.toMatch(/[╭╮╰╯│┌┐└┘├┤]/);
		expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(
			80
		);
		expect(res.stderr).toBe('');
	});

	it('shows a subtask by its full ID', () => {
		const res = show('2.2');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'Subtask 2.2  Sessions table and cookie middleware'
		);
		expect(res.stdout).toContain(
			'○ pending · medium priority · depends on 2.1'
		);
		expect(res.stdout).toContain(
			'Next: taskgraph set-status --id=2.2 --status=in-progress'
		);
	});

	it('prints the same facts line as next for a subtask stored without parentId or priority', () => {
		// As expand and add-subtask write them: no parentId, priority from the parent
		const tasksPath = path.join(testDir, '.taskgraph', 'tasks', 'tasks.json');
		const data = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
		for (const subtask of data.master.tasks[1].subtasks) {
			delete subtask.parentId;
			delete subtask.priority;
		}
		data.master.tasks[1].subtasks[1].status = 'in-progress';
		fs.writeFileSync(tasksPath, JSON.stringify(data, null, 2));
		const factsLine = (stdout: string) =>
			stdout.split('\n').find((line) => line.startsWith('▶'));

		const shown = show('2.2');
		const next = spawnSync(process.execPath, [binPath, 'next'], {
			cwd: testDir,
			encoding: 'utf8',
			env
		});

		expect(shown.status).toBe(0);
		expect(factsLine(shown.stdout)).toBe(
			'▶ in-progress · high priority · depends on 2.1'
		);
		expect(factsLine(next.stdout)).toBe(factsLine(shown.stdout));
	});

	it('filters subtasks by status', () => {
		const res = show('2', '--status', 'done');

		expect(res.status).toBe(0);
		expect(res.stdout).toContain(
			'Subtasks · 1 of 2 done\n  2.1  ✓ done  Password hashing helpers'
		);
		expect(res.stdout).not.toContain('Sessions table');
	});

	it('prints a missing task as an error on stderr with a hint and exits 1', () => {
		const res = show('9');

		expect(res.status).toBe(1);
		expect(res.stdout).not.toContain('Next:');
		expect(res.stderr).toContain('Task 9 not found');
		expect(res.stderr).toContain('taskgraph list');
	});
});
