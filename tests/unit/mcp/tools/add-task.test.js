/**
 * add_task MCP tool, run through the real @tm/mcp wrappers on a temp project.
 * Only the direct function, which calls the AI, is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAddTaskTool } from '../../../../mcp-server/src/tools/add-task.js';
import {
	createLog,
	createProject,
	registerTool,
	removeProject,
	responseText,
	tasksJsonPathOf
} from '../../../helpers/legacy-mcp-tool.js';

const { addTaskDirect } = vi.hoisted(() => ({ addTaskDirect: vi.fn() }));
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	addTaskDirect
}));

describe('MCP tool: add_task', () => {
	const tool = registerTool(registerAddTaskTool);
	let projectRoot;
	let log;

	beforeEach(() => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
		projectRoot = createProject();
		log = createLog();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		removeProject(projectRoot);
	});

	it('registers add_task with a schema that takes a prompt and project root', () => {
		expect(tool.name).toBe('add_task');
		expect(
			tool.parameters.safeParse({ prompt: 'Add login', projectRoot }).success
		).toBe(true);
	});

	it('passes the resolved tasks path and current tag to addTaskDirect', async () => {
		addTaskDirect.mockResolvedValue({
			success: true,
			data: { taskId: 5, message: 'Added task 5' }
		});

		const response = await tool.execute(
			{
				prompt: 'Add login',
				dependencies: '1,2',
				priority: 'high',
				research: true,
				acceptanceCriteria: ['Logs in'],
				projectRoot
			},
			{ log, session: {} }
		);

		expect(addTaskDirect).toHaveBeenCalledWith(
			expect.objectContaining({
				tasksJsonPath: tasksJsonPathOf(projectRoot),
				prompt: 'Add login',
				dependencies: '1,2',
				priority: 'high',
				research: true,
				acceptanceCriteria: ['Logs in'],
				projectRoot,
				tag: 'master'
			}),
			log,
			{ session: {} }
		);
		expect(response.isError).toBeUndefined();
		expect(JSON.parse(responseText(response))).toMatchObject({
			data: { taskId: 5 },
			tag: 'master'
		});
	});

	it('returns an error response when addTaskDirect fails', async () => {
		addTaskDirect.mockResolvedValue({
			success: false,
			error: { code: 'ADD_TASK_ERROR', message: 'Dependency 9 not found' }
		});

		const response = await tool.execute(
			{ prompt: 'Add login', projectRoot },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Error: Dependency 9 not found');
		expect(log.error).toHaveBeenCalledWith(
			'Error adding task: Dependency 9 not found'
		);
	});

	it('returns an error response when addTaskDirect throws', async () => {
		addTaskDirect.mockRejectedValue(new Error('Model unavailable'));

		const response = await tool.execute(
			{ prompt: 'Add login', projectRoot },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Error: Model unavailable');
	});

	it('refuses a tag that is not a safe name before calling addTaskDirect', async () => {
		const response = await tool.execute(
			{ prompt: 'Add login', projectRoot, tag: '../main' },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Invalid tag "../main"');
		expect(addTaskDirect).not.toHaveBeenCalled();
	});
});
