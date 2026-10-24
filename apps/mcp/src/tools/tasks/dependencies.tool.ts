/**
 * @fileoverview add_dependency, remove_dependency, validate_dependencies and
 * fix_dependencies MCP tools: thin layers over tm-core's tasks.addDependency,
 * removeDependency, validateDependencies and fixDependencies.
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const projectRoot = z
	.string()
	.describe('The directory of the project. Must be an absolute path.');
const tag = z.string().optional().describe('Tag context to operate on');

interface DependencyArgs {
	projectRoot: string;
	tag?: string;
	file?: string;
}

/**
 * Run a tool's work and reply with its data, or with the error it threw.
 * `file` is kept for older clients; tasks live only in the project's
 * tasks.json, so another path is refused rather than ignored.
 */
async function reply(
	args: DependencyArgs,
	{ log }: ToolContext,
	errorPrefix: string,
	work: () => Promise<{ data: unknown; tag?: string }>
) {
	try {
		const tasksPath = path.join(args.projectRoot, TASKGRAPH_TASKS_FILE);
		if (args.file && path.resolve(args.projectRoot, args.file) !== tasksPath) {
			throw new Error(
				`Tasks live in ${tasksPath}; a different file isn't supported`
			);
		}
		const { data, tag: usedTag } = await work();
		return handleApiResult({
			result: { success: true, data },
			log,
			errorPrefix,
			projectRoot: args.projectRoot,
			tag: usedTag ?? args.tag
		});
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		return handleApiResult({
			result: { success: false, error: { message } },
			log,
			errorPrefix,
			projectRoot: args.projectRoot,
			tag: args.tag
		});
	}
}

const AddDependencySchema = z.object({
	id: z.string().describe('ID of task that will depend on another task'),
	dependsOn: z.string().describe('ID of task that will become a dependency'),
	type: z
		.enum(['blocks', 'related', 'discovered-from'])
		.optional()
		.describe(
			'blocks (default): id waits for dependsOn. related or discovered-from: a link that never blocks next or shows in why'
		),
	file: z
		.string()
		.optional()
		.describe('Absolute path to the tasks file (default: tasks/tasks.json)'),
	projectRoot,
	tag
});

export function registerAddDependencyTool(server: FastMCP) {
	server.addTool({
		name: 'add_dependency',
		description:
			'Add a dependency between two tasks, or with type related / discovered-from a link that never blocks',
		parameters: AddDependencySchema,
		annotations: { title: 'Add Dependency', destructiveHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof AddDependencySchema>, context: ToolContext) =>
				reply(args, context, 'Error adding dependency', async () => {
					const result = await context.tmCore.tasks.addDependency(
						args.id,
						args.dependsOn,
						{ tag: args.tag, type: args.type }
					);
					return {
						tag: result.tag,
						data: {
							message:
								result.type === 'blocks'
									? `Successfully added dependency: Task ${result.taskId} now depends on ${result.dependencyId}`
									: `Linked task ${result.taskId} to ${result.dependencyId} as ${result.type}; it doesn't block`,
							taskId: result.taskId,
							dependencyId: result.dependencyId,
							type: result.type
						}
					};
				})
		)
	});
}

const RemoveDependencySchema = z.object({
	id: z.string().describe('Task ID to remove dependency from'),
	dependsOn: z.string().describe('Task ID to remove as a dependency'),
	file: z
		.string()
		.optional()
		.describe('Absolute path to the tasks file (default: tasks/tasks.json)'),
	projectRoot,
	tag
});

export function registerRemoveDependencyTool(server: FastMCP) {
	server.addTool({
		name: 'remove_dependency',
		description:
			'Remove a dependency, or a related / discovered-from link, from a task',
		parameters: RemoveDependencySchema,
		annotations: { title: 'Remove Dependency', destructiveHint: true },
		execute: withToolContext(
			async (
				args: z.infer<typeof RemoveDependencySchema>,
				context: ToolContext
			) =>
				reply(args, context, 'Error removing dependency', async () => {
					const result = await context.tmCore.tasks.removeDependency(
						args.id,
						args.dependsOn,
						{ tag: args.tag }
					);
					// Says what happened: a dependency the task never had is not removed
					return {
						tag: result.tag,
						data: {
							message: result.message,
							removed: result.removed,
							taskId: result.taskId,
							dependencyId: result.dependencyId
						}
					};
				})
		)
	});
}

const CheckSchema = z.object({
	file: z.string().optional().describe('Absolute path to the tasks file'),
	projectRoot,
	tag
});

export function registerValidateDependenciesTool(server: FastMCP) {
	server.addTool({
		name: 'validate_dependencies',
		description:
			'Check tasks for dependency issues (like circular references or links to non-existent tasks) without making changes.',
		parameters: CheckSchema,
		annotations: { title: 'Validate Dependencies', readOnlyHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof CheckSchema>, context: ToolContext) =>
				reply(args, context, 'Error validating dependencies', async () => {
					const result = await context.tmCore.tasks.validateDependencies({
						tag: args.tag
					});
					return {
						data: {
							message: result.valid
								? 'No dependency problems'
								: `Found ${result.issues.length} dependency problem(s)`,
							...result
						}
					};
				})
		)
	});
}

export function registerFixDependenciesTool(server: FastMCP) {
	server.addTool({
		name: 'fix_dependencies',
		description: 'Fix invalid dependencies in tasks automatically',
		parameters: CheckSchema,
		annotations: { title: 'Fix Dependencies', destructiveHint: true },
		execute: withToolContext(
			async (args: z.infer<typeof CheckSchema>, context: ToolContext) =>
				reply(args, context, 'Error fixing dependencies', async () => {
					const result = await context.tmCore.tasks.fixDependencies({
						tag: args.tag
					});
					return {
						tag: result.tag,
						data: {
							message:
								result.remaining.length > 0
									? `Fixed ${result.fixes.length} dependency problem(s); ${result.remaining.length} left that need a decision, such as loops between tasks`
									: `Fixed ${result.fixes.length} dependency problem(s)`,
							...result
						}
					};
				})
		)
	});
}
