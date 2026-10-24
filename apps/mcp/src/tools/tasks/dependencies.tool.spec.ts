/**
 * @fileoverview The four dependency MCP tools: their reply data and errors.
 * tm-core is faked at the createTmCore boundary; everything else is real.
 */

import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const tasks = {
	addDependency: vi.fn(),
	removeDependency: vi.fn(),
	validateDependencies: vi.fn(),
	fixDependencies: vi.fn()
};

vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn(async () => ({ tasks }))
}));

import {
	registerAddDependencyTool,
	registerFixDependenciesTool,
	registerRemoveDependencyTool,
	registerValidateDependenciesTool
} from './dependencies.tool.js';

type Tool = {
	name: string;
	execute: (args: Record<string, unknown>, ctx: unknown) => Promise<any>;
};

function register(registerTool: (server: any) => void): Tool {
	const registered: Tool[] = [];
	registerTool({ addTool: (tool: Tool) => registered.push(tool) });
	return registered[0];
}

const ctx = {
	log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	session: undefined
};
const projectRoot = process.cwd();
const reply = (result: any) => JSON.parse(result.content[0].text);

beforeEach(() => vi.clearAllMocks());

describe('add_dependency', () => {
	it('replies with what was added and the tag it was added in', async () => {
		tasks.addDependency.mockResolvedValue({
			taskId: '5',
			dependencyId: '1',
			type: 'blocks',
			changed: true,
			message: 'Task 5 now depends on task 1',
			tag: 'dev'
		});

		const result = await register(registerAddDependencyTool).execute(
			{ projectRoot, id: '5', dependsOn: '1', tag: 'dev' },
			ctx
		);

		expect(tasks.addDependency).toHaveBeenCalledWith('5', '1', {
			tag: 'dev',
			type: undefined
		});
		expect(reply(result)).toMatchObject({
			tag: 'dev',
			data: {
				message: 'Successfully added dependency: Task 5 now depends on 1',
				// Numbers, as the legacy replies gave them
				taskId: 5,
				dependencyId: 1,
				type: 'blocks'
			}
		});
	});

	it('says a link does not block', async () => {
		tasks.addDependency.mockResolvedValue({
			taskId: '5',
			dependencyId: '1',
			type: 'related',
			changed: true,
			message: '',
			tag: 'master'
		});

		const result = await register(registerAddDependencyTool).execute(
			{ projectRoot, id: '5', dependsOn: '1', type: 'related' },
			ctx
		);

		expect(reply(result).data.message).toBe(
			"Linked task 5 to 1 as related; it doesn't block"
		);
	});

	it('returns a refusal as an error reply', async () => {
		tasks.addDependency.mockRejectedValue(
			new Error("Task 2 can't depend on itself")
		);

		const result = await register(registerAddDependencyTool).execute(
			{ projectRoot, id: '2', dependsOn: '2', tag: 'master' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toMatch(
			/^Error: Task 2 can't depend on itself\n/
		);
	});

	it('refuses a tasks file other than the project one, before any change', async () => {
		const result = await register(registerAddDependencyTool).execute(
			{ projectRoot, id: '2', dependsOn: '1', file: '/elsewhere/tasks.json' },
			ctx
		);

		expect(result.isError).toBe(true);
		expect(tasks.addDependency).not.toHaveBeenCalled();
	});

	it('accepts the project tasks file as file', async () => {
		tasks.addDependency.mockResolvedValue({
			taskId: '2',
			dependencyId: '1',
			type: 'blocks',
			tag: 'master'
		});

		const result = await register(registerAddDependencyTool).execute(
			{
				projectRoot,
				id: '2',
				dependsOn: '1',
				file: path.join(projectRoot, '.taskgraph/tasks/tasks.json')
			},
			ctx
		);

		expect(result.isError).toBeUndefined();
	});
});

describe('remove_dependency', () => {
	it('says whether anything was removed', async () => {
		tasks.removeDependency.mockResolvedValue({
			taskId: '2',
			dependencyId: '5',
			removed: false,
			message: "Task 2 doesn't depend on task 5; nothing changed",
			tag: 'master'
		});

		const result = await register(registerRemoveDependencyTool).execute(
			{ projectRoot, id: '2', dependsOn: '5' },
			ctx
		);

		expect(reply(result).data).toEqual({
			message: "Task 2 doesn't depend on task 5; nothing changed",
			removed: false,
			taskId: 2,
			dependencyId: 5
		});
	});
});

describe('reply IDs', () => {
	it('gives a task ID as a number and a subtask ID as a string, as legacy did', async () => {
		tasks.addDependency.mockResolvedValue({
			taskId: '2.3',
			dependencyId: '4',
			type: 'blocks',
			changed: true,
			message: '',
			tag: 'master'
		});
		tasks.validateDependencies.mockResolvedValue({
			valid: false,
			issues: [
				{ type: 'missing', taskId: '1', dependencyId: '99', message: 'x' },
				{ type: 'circular', taskId: '2.1', message: 'x' },
				{ type: 'missing-link', taskId: '3', dependencyId: '9', message: 'x' }
			],
			taskCount: 3,
			subtaskCount: 1,
			dependencyCount: 1,
			prdCoverage: null,
			tasksPath: '/p/.taskgraph/tasks/tasks.json'
		});

		const added = reply(
			await register(registerAddDependencyTool).execute(
				{ projectRoot, id: '2.3', dependsOn: '4' },
				ctx
			)
		).data;
		const issues = reply(
			await register(registerValidateDependenciesTool).execute(
				{ projectRoot },
				ctx
			)
		).data.issues;

		expect([added.taskId, added.dependencyId]).toEqual(['2.3', 4]);
		// dependencyId stays as stored; a link issue's taskId was a string
		expect(issues.map((i: any) => [i.taskId, i.dependencyId])).toEqual([
			[1, '99'],
			['2.1', undefined],
			['3', '9']
		]);
	});
});

describe('validate_dependencies and fix_dependencies', () => {
	const counts = { taskCount: 2, subtaskCount: 0, dependencyCount: 1 };

	it('validate replies with the issues, counts and a summary', async () => {
		tasks.validateDependencies.mockResolvedValue({
			valid: false,
			issues: [{ type: 'missing', taskId: 2, dependencyId: 99, message: 'x' }],
			...counts,
			prdCoverage: null,
			tasksPath: '/p/.taskgraph/tasks/tasks.json'
		});

		const result = await register(registerValidateDependenciesTool).execute(
			{ projectRoot },
			ctx
		);

		expect(reply(result).data).toMatchObject({
			message: 'Found 1 dependency problem(s)',
			valid: false,
			...counts,
			prdCoverage: null
		});
	});

	it('fix says what is left for the user', async () => {
		tasks.fixDependencies.mockResolvedValue({
			fixes: [{ type: 'self', taskId: 1 }],
			remaining: [{ type: 'circular', taskId: 2, message: 'x' }],
			changed: true,
			...counts,
			tag: 'master',
			tasksPath: '/p/.taskgraph/tasks/tasks.json'
		});

		const result = await register(registerFixDependenciesTool).execute(
			{ projectRoot },
			ctx
		);

		expect(reply(result).data).toMatchObject({
			message:
				'Fixed 1 dependency problem(s); 1 left that need a decision, such as loops between tasks',
			changed: true,
			tag: 'master'
		});
	});
});
