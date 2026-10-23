/**
 * analyze_project_complexity MCP tool, run through the real @tm/mcp wrappers
 * on a temp project. Only the direct function, which calls the AI, is mocked.
 */
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAnalyzeProjectComplexityTool } from '../../../../mcp-server/src/tools/analyze.js';
import {
	createLog,
	createProject,
	registerTool,
	removeProject,
	responseText,
	tasksJsonPathOf
} from '../../../helpers/legacy-mcp-tool.js';

const { analyzeTaskComplexityDirect } = vi.hoisted(() => ({
	analyzeTaskComplexityDirect: vi.fn()
}));
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	analyzeTaskComplexityDirect
}));

describe('MCP tool: analyze_project_complexity', () => {
	const tool = registerTool(registerAnalyzeProjectComplexityTool);
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

	it('registers the tool and reads a threshold given as a string as a number', () => {
		expect(tool.name).toBe('analyze_project_complexity');
		expect(
			tool.parameters.parse({ threshold: '7', projectRoot }).threshold
		).toBe(7);
		for (const threshold of [7.5, 11]) {
			expect(
				tool.parameters.safeParse({ threshold, projectRoot }).success
			).toBe(false);
		}
	});

	it('passes the tasks path, report path and options to the direct function', async () => {
		analyzeTaskComplexityDirect.mockResolvedValue({
			success: true,
			data: { reportSummary: { taskCount: 3 } }
		});

		const response = await tool.execute(
			{ threshold: 7, research: true, ids: '1,3', projectRoot },
			{ log, session: {} }
		);

		const [args] = analyzeTaskComplexityDirect.mock.calls[0];
		expect(args).toMatchObject({
			tasksJsonPath: tasksJsonPathOf(projectRoot),
			threshold: 7,
			research: true,
			ids: '1,3',
			projectRoot,
			tag: 'master'
		});
		expect(
			args.outputPath.startsWith(path.join(projectRoot, '.taskgraph'))
		).toBe(true);
		expect(JSON.parse(responseText(response))).toMatchObject({
			data: { reportSummary: { taskCount: 3 } },
			tag: 'master'
		});
	});

	it('refuses an output path outside the project root', async () => {
		const response = await tool.execute(
			{ output: '../report.json', projectRoot },
			{ log, session: {} }
		);

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('outside the project root');
		expect(analyzeTaskComplexityDirect).not.toHaveBeenCalled();
	});

	it('returns an error response when the direct function fails', async () => {
		analyzeTaskComplexityDirect.mockResolvedValue({
			success: false,
			error: { code: 'ANALYZE_ERROR', message: 'No tasks to analyze' }
		});

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain('Error: No tasks to analyze');
		expect(log.error).toHaveBeenCalledWith(
			'Error analyzing task complexity: No tasks to analyze'
		);
	});

	it('returns an error response when the direct function throws', async () => {
		analyzeTaskComplexityDirect.mockRejectedValue(new Error('Model timeout'));

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain(
			'Internal tool error (analyze_project_complexity): Model timeout'
		);
	});
});
