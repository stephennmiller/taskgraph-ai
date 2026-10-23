/**
 * expand_all MCP tool, run through the real @tm/mcp wrappers on a temp
 * project. Only the direct function, which calls the AI, is mocked.
 */
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerExpandAllTool } from '../../../../mcp-server/src/tools/expand-all.js';
import {
	createLog,
	createProject,
	registerTool,
	removeProject,
	responseText,
	tasksJsonPathOf
} from '../../../helpers/legacy-mcp-tool.js';

const { expandAllTasksDirect } = vi.hoisted(() => ({
	expandAllTasksDirect: vi.fn()
}));
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	expandAllTasksDirect
}));

describe('MCP tool: expand_all', () => {
	const tool = registerTool(registerExpandAllTool);
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

	it('registers expand_all', () => {
		expect(tool.name).toBe('expand_all');
		expect(
			tool.parameters.safeParse({ num: '3', force: true, projectRoot }).success
		).toBe(true);
	});

	it('passes the options, tasks path and complexity report path to the direct function', async () => {
		expandAllTasksDirect.mockResolvedValue({
			success: true,
			data: { expandedCount: 2, failedCount: 1, skippedCount: 0 }
		});

		const response = await tool.execute(
			{
				num: '3',
				research: true,
				prompt: 'Keep it small',
				force: true,
				projectRoot,
				tag: 'feature'
			},
			{ log, session: {} }
		);

		const [args] = expandAllTasksDirect.mock.calls[0];
		expect(args).toMatchObject({
			tasksJsonPath: tasksJsonPathOf(projectRoot),
			num: '3',
			research: true,
			prompt: 'Keep it small',
			force: true,
			projectRoot,
			tag: 'feature'
		});
		expect(
			args.complexityReportPath.startsWith(path.join(projectRoot, '.taskgraph'))
		).toBe(true);
		expect(JSON.parse(responseText(response))).toMatchObject({
			data: { expandedCount: 2, failedCount: 1 },
			tag: 'feature'
		});
	});

	it('returns an error response when the direct function fails', async () => {
		expandAllTasksDirect.mockResolvedValue({
			success: false,
			error: { code: 'EXPAND_ALL_ERROR', message: 'No tasks to expand' }
		});

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Error: No tasks to expand');
		expect(log.error).toHaveBeenCalledWith(
			'Error expanding all tasks: No tasks to expand'
		);
	});

	it('returns an error response when the direct function throws', async () => {
		expandAllTasksDirect.mockRejectedValue(new Error('Model timeout'));

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain(
			'An unexpected error occurred: Model timeout'
		);
	});
});
