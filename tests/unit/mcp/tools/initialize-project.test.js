/**
 * initialize_project MCP tool, run through the real @tm/mcp wrappers. Only
 * the direct function, which writes the project files, is mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerInitializeProjectTool } from '../../../../mcp-server/src/tools/initialize-project.js';
import {
	createLog,
	createProject,
	registerTool,
	removeProject,
	responseText
} from '../../../helpers/legacy-mcp-tool.js';

const { initializeProjectDirect } = vi.hoisted(() => ({
	initializeProjectDirect: vi.fn()
}));
vi.mock('../../../../mcp-server/src/core/taskgraph-core.js', () => ({
	initializeProjectDirect
}));

describe('MCP tool: initialize_project', () => {
	const tool = registerTool(registerInitializeProjectTool);
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

	it('registers initialize_project with only known rule profiles', () => {
		expect(tool.name).toBe('initialize_project');
		expect(
			tool.parameters.safeParse({ projectRoot, rules: ['claude'] }).success
		).toBe(true);
		expect(
			tool.parameters.safeParse({ projectRoot, rules: ['not-a-profile'] })
				.success
		).toBe(false);
	});

	it('passes the arguments with the normalized project root to the direct function', async () => {
		initializeProjectDirect.mockResolvedValue({
			success: true,
			data: { message: 'Project initialized' }
		});

		const response = await tool.execute(
			{ projectRoot: `file://${projectRoot}`, skipInstall: true, yes: true },
			{ log, session: {} }
		);

		expect(initializeProjectDirect).toHaveBeenCalledWith(
			{ projectRoot, skipInstall: true, yes: true },
			log,
			{ session: {} }
		);
		expect(JSON.parse(responseText(response))).toMatchObject({
			data: { message: 'Project initialized' }
		});
	});

	it('takes the project root from the session when none is passed', async () => {
		initializeProjectDirect.mockResolvedValue({ success: true, data: {} });

		await tool.execute(
			{ yes: true },
			{ log, session: { roots: [{ uri: `file://${projectRoot}` }] } }
		);

		expect(initializeProjectDirect.mock.calls[0][0].projectRoot).toBe(
			projectRoot
		);
	});

	it('returns an error response when initialization fails', async () => {
		initializeProjectDirect.mockResolvedValue({
			success: false,
			error: { code: 'INIT_FAILED', message: 'Directory is not writable' }
		});

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain(
			'Error: Directory is not writable'
		);
		expect(log.error).toHaveBeenCalledWith(
			'Initialization failed: Directory is not writable'
		);
	});

	it('returns an error response when the direct function throws', async () => {
		initializeProjectDirect.mockRejectedValue(new Error('Disk full'));

		const response = await tool.execute({ projectRoot }, { log, session: {} });

		expect(response.isError).toBe(true);
		expect(responseText(response)).toContain(
			'Project initialization tool failed: Disk full'
		);
	});
});
