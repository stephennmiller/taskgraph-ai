/**
 * @fileoverview add_dependency, remove_dependency, validate_dependencies and
 * fix_dependencies MCP tools: thin layers over tm-core's tasks.addDependency,
 * removeDependency, validateDependencies and fixDependencies.
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { replyId, replyWith } from '../../shared/tool-reply.js';
import { withToolContext } from '../../shared/utils.js';

const projectRoot = z
	.string()
	.describe('The directory of the project. Must be an absolute path.');
const tag = z.string().optional().describe('Tag context to operate on');

/**
 * Validate and fix issues with each task's ID as the legacy replies gave it.
 * A link issue's `taskId` was already a string, and `dependencyId` is as
 * stored in both.
 */
function withReplyIds<T extends { type: string; taskId: string | number }>(
	items: T[]
): T[] {
	return items.map((item) =>
		item.type === 'missing-link'
			? item
			: { ...item, taskId: replyId(item.taskId) }
	);
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
				replyWith(args, context, 'Error adding dependency', async () => {
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
							taskId: replyId(result.taskId),
							dependencyId: replyId(result.dependencyId),
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
				replyWith(args, context, 'Error removing dependency', async () => {
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
							taskId: replyId(result.taskId),
							dependencyId: replyId(result.dependencyId)
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
				replyWith(args, context, 'Error validating dependencies', async () => {
					const result = await context.tmCore.tasks.validateDependencies({
						tag: args.tag
					});
					return {
						data: {
							message: result.valid
								? 'No dependency problems'
								: `Found ${result.issues.length} dependency problem(s)`,
							...result,
							issues: withReplyIds(result.issues)
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
				replyWith(args, context, 'Error fixing dependencies', async () => {
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
							...result,
							fixes: withReplyIds(result.fixes),
							remaining: withReplyIds(result.remaining)
						}
					};
				})
		)
	});
}
