/**
 * @fileoverview Integration tests for 'taskgraph list' command
 *
 * Tests the list command which displays all tasks with optional filtering.
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

describe('list command', () => {
	let testDir: string;
	let tasksPath: string;
	let binPath: string;

	beforeEach(() => {
		testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-list-test-'));
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

	const runList = (args = ''): { output: string; exitCode: number } => {
		try {
			const output = execSync(`node "${binPath}" list ${args}`, {
				encoding: 'utf-8',
				stdio: 'pipe',
				// No FORCE_COLOR from the runner's shell: a pipe alone decides
				env: {
					...process.env,
					FORCE_COLOR: undefined,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			});
			return { output, exitCode: 0 };
		} catch (error: any) {
			return {
				output: error.stderr?.toString() || error.stdout?.toString() || '',
				exitCode: error.status || 1
			};
		}
	};

	/** Task 2 is in progress; `next` picks its subtask 2.2 (#246) */
	const subtaskProject = () =>
		createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'Set up the database', status: 'done' }),
				createTask({
					id: 2,
					title: 'Sign-in with sessions',
					status: 'in-progress',
					priority: 'high',
					dependencies: ['1'],
					subtasks: [
						createSubtask({
							id: 1,
							parentId: '2',
							title: 'Password hashing',
							status: 'done'
						}),
						createSubtask({
							id: 2,
							parentId: '2',
							title: 'Sessions table and cookie middleware',
							status: 'pending',
							dependencies: [1]
						}),
						createSubtask({
							id: 3,
							parentId: '2',
							title: 'Sign-in rate limiting',
							status: 'pending',
							dependencies: [2]
						})
					]
				}),
				createTask({
					id: 3,
					title: 'Bookmark endpoints',
					status: 'pending',
					dependencies: ['2']
				})
			]
		});

	describe('compact output (#182, #246)', () => {
		// --format text: the terminal view, which a pipe only gets on request
		const runAt80 = (args: string[] = []) =>
			spawnSync('node', [binPath, 'list', '--format', 'text', ...args], {
				encoding: 'utf-8',
				env: {
					...process.env,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1',
					COLUMNS: '80',
					NO_COLOR: '1'
				}
			}).stdout;

		it('prints a summary and one Next: line, with no boxes, within 80 columns', () => {
			writeTasks(subtaskProject());

			const output = runAt80();

			expect(output).toMatch(/^Tasks {5}/m);
			expect(output).not.toMatch(/[╭╮╰╯]/);
			expect(output).not.toContain('Project Dashboard');
			expect(output).not.toContain('Suggested Next Steps');
			expect(output.match(/^Next: /gm)).toHaveLength(1);
			for (const line of output.split('\n')) {
				expect(line.length).toBeLessThanOrEqual(80);
			}
		});

		it('shows the subtask next picks, not "No task available" (#246)', () => {
			writeTasks(subtaskProject());

			const output = runAt80();

			expect(output).toMatch(
				/^Next {6}2\.2 {2}Sessions table and cookie middleware/m
			);
			expect(output).not.toContain('No task available');
			expect(output).toContain('Next: taskgraph set-status 2.2 in-progress');
		});

		it('counts subtasks without --with-subtasks (#246)', () => {
			writeTasks(subtaskProject());

			const output = runAt80();

			expect(output).toMatch(/^Subtasks .*1 of 3 done · 33%/m);
			// The table itself still hides them
			expect(output).not.toContain('Password hashing');
		});

		it('says which filter matched nothing, with a way back', () => {
			writeTasks(subtaskProject());

			const output = runAt80(['--status', 'review']);

			expect(output).toContain('No review tasks found');
			expect(output).toContain('Next: taskgraph list to see every task');
			expect(output).not.toMatch(/[╭╮╰╯]/);
		});
	});

	describe('piped output (#250)', () => {
		const runPiped = (args: string[]) =>
			spawnSync('node', [binPath, ...args], {
				encoding: 'utf-8',
				// No FORCE_COLOR from the runner's shell: a pipe alone decides
				env: {
					...process.env,
					FORCE_COLOR: undefined,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			});

		it('prints one plain line per task with full titles', () => {
			writeTasks(subtaskProject());

			const { stdout, status } = runPiped(['list']);

			expect(status).toBe(0);
			expect(stdout.trimEnd().split('\n')).toEqual([
				'<task-data>',
				'1  done         medium  Set up the database',
				'2  in-progress  high    Sign-in with sessions  deps:1',
				'3  pending      medium  Bookmark endpoints  deps:2',
				'</task-data>'
			]);
		});

		it('lists subtasks with dotted IDs when asked', () => {
			writeTasks(subtaskProject());

			const { stdout } = runPiped(['list', '--with-subtasks']);

			expect(stdout).toMatch(
				/^2\.2 +pending +\S+ +Sessions table and cookie middleware {2}deps:2\.1$/m
			);
		});

		it('filters by status without reporting other tasks as missing', () => {
			writeTasks(subtaskProject());

			const { stdout, stderr, status } = runPiped([
				'list',
				'--status',
				'pending'
			]);

			expect(status).toBe(0);
			expect(stdout.trimEnd().split('\n')).toEqual([
				'<task-data>',
				'3  pending  medium  Bookmark endpoints  deps:2',
				'</task-data>'
			]);
			expect(stderr).not.toContain('non-existent');
		});

		it('keeps the table when --format text is given', () => {
			writeTasks(subtaskProject());

			const { stdout } = runPiped(['list', '--format', 'text']);

			expect(stdout).toMatch(/^Tasks {5}/m);
			expect(stdout).toContain('│');
		});

		it.each([
			['list'],
			['list', '--with-subtasks'],
			['list', '--status', 'review'],
			['next'],
			['show', '2']
		])('sends no ANSI escape codes through a pipe: %s', (...args) => {
			writeTasks(subtaskProject());

			const { stdout, stderr } = runPiped(args);

			expect(stdout).not.toContain('\u001b');
			expect(stderr).not.toContain('\u001b');
		});
	});

	describe('dependency warnings (#365, #366)', () => {
		const runPiped = (args: string[]) =>
			spawnSync('node', [binPath, ...args], {
				encoding: 'utf-8',
				env: {
					...process.env,
					FORCE_COLOR: undefined,
					TASKGRAPH_SKIP_AUTO_UPDATE: '1'
				}
			});

		it.each([['--json'], ['--compact']])(
			'filters by status with %s without reporting other tasks as missing',
			(format) => {
				writeTasks(subtaskProject());

				const { stderr, status } = runPiped([
					'list',
					'--status',
					'pending',
					format
				]);

				expect(status).toBe(0);
				expect(stderr).not.toContain('non-existent');
			}
		);

		it('strips escape codes from a dependency ID in the task file', () => {
			writeTasks(
				createTasksFile({
					tasks: [
						createTask({
							id: 1,
							title: 'Avatar upload',
							dependencies: ['9\u001b]0;pwned\u0007']
						})
					]
				})
			);

			const { stderr } = runPiped(['list', '--json']);

			expect(stderr).toContain('Task 1 depends on non-existent task 9\n');
			expect(stderr).toContain('Run taskgraph fix-dependencies to fix them');
			expect(stderr).not.toContain('\u001b');
			expect(stderr).not.toContain('pwned');
		});
	});

	it('should display message when no tasks exist', () => {
		const { output, exitCode } = runList();

		expect(exitCode).toBe(0);
		expect(output).toContain('No tasks found');
	});

	it('should list all tasks with correct information', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Setup Environment',
					description: 'Install and configure',
					status: 'done',
					priority: 'high'
				}),
				createTask({
					id: 2,
					title: 'Write Tests',
					description: 'Create test suite',
					status: 'in-progress',
					priority: 'high',
					dependencies: ['1']
				}),
				createTask({
					id: 3,
					title: 'Implement Feature',
					description: 'Build the thing',
					status: 'pending',
					priority: 'medium',
					dependencies: ['2']
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runList();

		expect(exitCode).toBe(0);
		expect(output).toContain('Setup Environment');
		expect(output).toContain('Write Tests');
		expect(output).toContain('Implement Feature');
	});

	it('should display task statuses', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Done Task',
					status: 'done',
					priority: 'high'
				}),
				createTask({
					id: 2,
					title: 'Pending Task',
					status: 'pending',
					priority: 'high'
				}),
				createTask({
					id: 3,
					title: 'In Progress',
					status: 'in-progress',
					priority: 'high'
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runList();

		expect(exitCode).toBe(0);
		// Should show status indicators (exact format may vary)
		expect(output.toLowerCase()).toContain('done');
		expect(output.toLowerCase()).toContain('pending');
		expect(output.toLowerCase()).toContain('progress');
	});

	it('should show subtasks when --with-subtasks flag is used', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({
					id: 1,
					title: 'Parent Task',
					status: 'in-progress',
					subtasks: [
						createSubtask({
							id: '1.1',
							title: 'First Subtask',
							status: 'done',
							parentId: '1'
						}),
						createSubtask({
							id: '1.2',
							title: 'Second Subtask',
							status: 'pending',
							parentId: '1'
						})
					]
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runList('--with-subtasks');

		expect(exitCode).toBe(0);
		expect(output).toContain('Parent Task');
		expect(output).toContain('First Subtask');
		expect(output).toContain('Second Subtask');
	});

	it('should handle tasks with dependencies', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'Foundation', status: 'done' }),
				createTask({
					id: 2,
					title: 'Dependent Task',
					status: 'pending',
					dependencies: ['1']
				})
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runList();

		expect(exitCode).toBe(0);
		expect(output).toContain('Foundation');
		expect(output).toContain('Dependent Task');
	});

	it('should display multiple tasks in order', () => {
		const testData = createTasksFile({
			tasks: [
				createTask({ id: 1, title: 'Task One', status: 'pending' }),
				createTask({ id: 2, title: 'Task Two', status: 'pending' }),
				createTask({ id: 3, title: 'Task Three', status: 'pending' }),
				createTask({ id: 4, title: 'Task Four', status: 'pending' }),
				createTask({ id: 5, title: 'Task Five', status: 'pending' })
			]
		});
		writeTasks(testData);

		const { output, exitCode } = runList();

		expect(exitCode).toBe(0);
		expect(output).toContain('Task One');
		expect(output).toContain('Task Two');
		expect(output).toContain('Task Three');
		expect(output).toContain('Task Four');
		expect(output).toContain('Task Five');
	});

	describe('error handling - validation errors should surface to CLI', () => {
		it('should display validation error when task has missing title', () => {
			const testData = {
				master: {
					tasks: [
						{
							id: 1,
							title: '', // ❌ Invalid - empty title
							description: 'A task without a title',
							status: 'pending',
							priority: 'high',
							dependencies: [],
							details: '',
							testStrategy: '',
							subtasks: []
						}
					],
					metadata: {
						version: '1.0.0',
						lastModified: new Date().toISOString(),
						taskCount: 1,
						completedCount: 0
					}
				}
			};
			writeTasks(testData);

			const { output, exitCode } = runList();

			expect(exitCode).toBe(1);
			expect(output.toLowerCase()).toContain('title');
			expect(output.toLowerCase()).toContain('required');
			expect(output).not.toContain('Failed to get task list');
		});

		it('should display validation error for first invalid task when multiple tasks exist', () => {
			const testData = {
				master: {
					tasks: [
						{
							id: 1,
							title: 'Valid Task',
							description: 'This one is fine',
							status: 'pending',
							priority: 'high',
							dependencies: [],
							details: '',
							testStrategy: '',
							subtasks: []
						},
						{
							id: 2,
							title: '', // ❌ Invalid - this should trigger error
							description: 'A task without a title',
							status: 'pending',
							priority: 'high',
							dependencies: [],
							details: '',
							testStrategy: '',
							subtasks: []
						},
						{
							id: 3,
							title: 'Another Valid Task',
							description: 'This would be fine too',
							status: 'pending',
							priority: 'high',
							dependencies: [],
							details: '',
							testStrategy: '',
							subtasks: []
						}
					],
					metadata: {
						version: '1.0.0',
						lastModified: new Date().toISOString(),
						taskCount: 3,
						completedCount: 0
					}
				}
			};
			writeTasks(testData);

			const { output, exitCode } = runList();

			expect(exitCode).toBe(1);
			expect(output.toLowerCase()).toContain('title');
			expect(output.toLowerCase()).toContain('required');
		});

		it('should handle all valid tasks without errors', () => {
			// This test verifies the fix doesn't break valid scenarios
			const testData = createTasksFile({
				tasks: [
					createTask({
						id: 1,
						title: 'Valid Task 1',
						description: 'This task is valid',
						status: 'pending',
						priority: 'high'
					}),
					createTask({
						id: 2,
						title: 'Valid Task 2',
						description: 'This task is also valid',
						status: 'done',
						priority: 'medium'
					})
				]
			});
			writeTasks(testData);

			const { output, exitCode } = runList();

			expect(exitCode).toBe(0);
			expect(output).toContain('Valid Task 1');
			expect(output).toContain('Valid Task 2');
		});
	});
});
