/**
 * MCP expand_task reads the task from the tag it was passed, not the current
 * tag (#459). A real tasks.json is read by the real readJSON; only the AI
 * expansion is mocked.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { vi } from 'vitest';
import { expandTaskDirect } from '../../../../mcp-server/src/core/direct-functions/expand-task.js';

vi.mock('../../../../scripts/modules/task-manager/expand-task.js', () => ({
	default: vi.fn(async () => ({ task: null, telemetryData: null }))
}));

const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };

const task = (status, subtasks = []) => ({
	id: 3,
	title: `Task 3 (${status})`,
	description: '',
	status,
	priority: 'medium',
	details: '',
	testStrategy: '',
	dependencies: [],
	subtasks
});
const subtask = (id) => ({ ...task('pending'), id, title: `Sub ${id}` });

describe('expandTaskDirect with a non-current tag', () => {
	let dir;
	let tasksJsonPath;

	const write = (masterTasks, featureTasks) =>
		fs.writeFileSync(
			tasksJsonPath,
			JSON.stringify({
				master: { tasks: masterTasks, metadata: {} },
				feature: { tasks: featureTasks, metadata: {} }
			})
		);
	const expand = (extra = {}) =>
		expandTaskDirect(
			{ tasksJsonPath, projectRoot: dir, id: '3', tag: 'feature', ...extra },
			log
		);

	beforeEach(() => {
		dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-expand-tag-'));
		const tasksDir = path.join(dir, '.taskgraph', 'tasks');
		fs.mkdirSync(tasksDir, { recursive: true });
		tasksJsonPath = path.join(tasksDir, 'tasks.json');
		fs.writeFileSync(
			path.join(dir, '.taskgraph', 'state.json'),
			JSON.stringify({ currentTag: 'master' })
		);
	});
	afterEach(() => {
		fs.rmSync(dir, { recursive: true, force: true });
	});

	it('does not report TASK_COMPLETED from the current tag', async () => {
		write([task('done')], [task('pending', [subtask(1)])]);

		const result = await expand();

		expect(result.success).toBe(true);
		expect(result.data.task.title).toBe('Task 3 (pending)');
	});

	it('finds a task that exists only in the passed tag', async () => {
		write([], [task('pending', [subtask(1)])]);

		const result = await expand();

		expect(result.success).toBe(true);
	});

	it('counts subtasksAdded from the passed tag', async () => {
		write([task('pending')], [task('pending', [subtask(1), subtask(2)])]);

		const result = await expand({ force: true });

		expect(result.success).toBe(true);
		expect(result.data.subtasksAdded).toBe(2);
	});
});
