/**
 * remove_task MCP tool, run through the real @tm/mcp wrappers on a temp
 * project. Only the direct function is mocked.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRemoveTaskTool } from '../../../../mcp-server/src/tools/remove-task.js';
import {
	createLog,
	createProject,
	registerTool,
	removeProject,
	responseText,
	tasksJsonPathOf
} from '../../../helpers/legacy-mcp-tool.js';

const { removeTaskDirect } = vi.hoisted(() => ({
	removeTaskDirect: vi.fn()
}));
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	removeTaskDirect
}));

describe('MCP tool: remove_task', () => {
	const tool = registerTool(registerRemoveTaskTool);
	const log = createLog();
	let projectRoot;

	const setup = (options) => {
		vi.stubEnv('TASKGRAPH_PROJECT_ROOT', '');
		projectRoot = createProject(options);
	};

	afterEach(() => {
		vi.unstubAllEnvs();
		removeProject(projectRoot);
	});

	it('registers remove_task with a required id', () => {
		setup();

		expect(tool.name).toBe('remove_task');
		expect(tool.parameters.safeParse({ projectRoot }).success).toBe(false);
		expect(tool.parameters.safeParse({ id: '5', projectRoot }).success).toBe(
			true
		);
	});

	it('passes the ids, tasks path and tag to removeTaskDirect', async () => {
		setup();
		removeTaskDirect.mockResolvedValue({
			success: true,
			data: { totalTasks: 2, successful: 2, failed: 0 }
		});

		const response = await tool.execute(
			{ id: '5,6.1', projectRoot, tag: 'feature' },
			{ log, session: {} }
		);

		expect(removeTaskDirect).toHaveBeenCalledWith(
			{
				tasksJsonPath: tasksJsonPathOf(projectRoot),
				id: '5,6.1',
				projectRoot,
				tag: 'feature'
			},
			log,
			{ session: {} }
		);
		expect(JSON.parse(responseText(response))).toMatchObject({
			data: { successful: 2 },
			tag: 'feature'
		});
	});

	it('uses the current tag from state.json when no tag is given', async () => {
		setup({ currentTag: 'sprint-2' });
		removeTaskDirect.mockResolvedValue({ success: true, data: {} });

		await tool.execute({ id: '5', projectRoot }, { log, session: {} });

		expect(removeTaskDirect.mock.calls[0][0].tag).toBe('sprint-2');
	});

	it('returns an error response when removeTaskDirect fails', async () => {
		setup();
		removeTaskDirect.mockResolvedValue({
			success: false,
			error: { code: 'INVALID_TASK_ID', message: 'Task 99 not found' }
		});

		const response = await tool.execute(
			{ id: '99', projectRoot },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Error: Task 99 not found');
		expect(log.error).toHaveBeenCalledWith(
			'Error removing task: Task 99 not found'
		);
	});

	it('returns an error response when removeTaskDirect throws', async () => {
		setup();
		removeTaskDirect.mockRejectedValue(new Error('File locked'));

		const response = await tool.execute(
			{ id: '5', projectRoot },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain(
			'Failed to remove task: File locked'
		);
	});
});
