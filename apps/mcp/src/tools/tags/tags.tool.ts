/**
 * @fileoverview Tag MCP tools: list_tags, add_tag, use_tag, delete_tag,
 * rename_tag, copy_tag
 */

import { neutralizeTaskData, TASK_DATA_NOTE, type TmCore } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const projectRoot = z
	.string()
	.describe('The directory of the project. Must be an absolute path.');

/** The add_tag replies for the git checks behind fromBranch, by error code */
const GIT_ERRORS: Record<string, string> = {
	NOT_GIT_REPO: 'Not in a git repository. Cannot use fromBranch option.',
	NO_CURRENT_BRANCH: 'Could not determine current git branch.'
};

/**
 * Run a tag tool and reply with its data, or with the error's message. The
 * reply names the current tag as state.json has it after the change.
 */
function tagTool<TArgs extends { projectRoot: string }>(
	errorPrefix: string,
	run: (args: TArgs, tmCore: TmCore) => Promise<unknown>,
	note?: string
) {
	return withToolContext(async (args: TArgs, { log, tmCore }: ToolContext) => {
		let result: {
			success: boolean;
			data?: unknown;
			error?: { message: string };
		};
		try {
			result = { success: true, data: await run(args, tmCore) };
		} catch (error: any) {
			result = {
				success: false,
				error: { message: GIT_ERRORS[error?.code] ?? error.message }
			};
		}
		return handleApiResult({
			result,
			log,
			errorPrefix,
			projectRoot: args.projectRoot,
			note
		});
	});
}

const ListTagsSchema = z.object({
	showMetadata: z
		.boolean()
		.optional()
		.describe('Whether to include metadata in the output (default: false)'),
	projectRoot
});

export function registerListTagsTool(server: FastMCP) {
	server.addTool({
		name: 'list_tags',
		description: 'List all available tags with task counts and metadata',
		parameters: ListTagsSchema,
		annotations: { title: 'List Tags', readOnlyHint: true },
		execute: tagTool<z.infer<typeof ListTagsSchema>>(
			'Error listing tags',
			async (_args, tmCore) => {
				const result = await tmCore.tasks.listTags();
				// Tag descriptions are text from tasks.json, like task text
				return neutralizeTaskData({
					tags: result.tags.map((tag) => ({
						name: tag.name,
						isCurrent: tag.isCurrent,
						taskCount: tag.taskCount,
						completedTasks: tag.completedTasks,
						statusBreakdown: tag.statusBreakdown,
						subtaskCounts: tag.subtaskCounts,
						created: tag.created,
						description: tag.description
					})),
					currentTag: result.currentTag,
					totalTags: result.totalTags,
					message: `Found ${result.totalTags} tag(s)`
				});
			},
			TASK_DATA_NOTE
		)
	});
}

const AddTagSchema = z.object({
	name: z.string().describe('Name of the new tag to create'),
	copyFromCurrent: z
		.boolean()
		.optional()
		.describe('Whether to copy tasks from the current tag (default: false)'),
	copyFromTag: z
		.string()
		.optional()
		.describe('Specific tag to copy tasks from'),
	fromBranch: z
		.boolean()
		.optional()
		.describe(
			'Create tag name from current git branch (ignores name parameter)'
		),
	description: z
		.string()
		.optional()
		.describe('Optional description for the tag'),
	projectRoot
});

export function registerAddTagTool(server: FastMCP) {
	server.addTool({
		name: 'add_tag',
		description: 'Create a new tag for organizing tasks in different contexts',
		parameters: AddTagSchema,
		annotations: { title: 'Add Tag', destructiveHint: false },
		execute: tagTool<z.infer<typeof AddTagSchema>>(
			'Error creating tag',
			async (args, tmCore) => {
				const options = {
					copyFromCurrent: args.copyFromCurrent,
					copyFromTag: args.copyFromTag,
					description: args.description
				};
				if (args.fromBranch) {
					const result = await tmCore.tasks.createTagFromBranch(
						(tagName, { defaultDescription }) =>
							tmCore.tasks.createTag(tagName, {
								...options,
								defaultDescription
							})
					);
					return {
						branchName: result.branchName,
						tagName: result.tagName,
						created: result.created.created,
						mappingUpdated: result.mappingUpdated,
						message: `Successfully created tag "${result.tagName}" from git branch "${result.branchName}"`
					};
				}
				const created = await tmCore.tasks.createTag(args.name, options);
				return {
					tagName: created.tagName,
					created: created.created,
					tasksCopied: created.tasksCopied,
					sourceTag: created.sourceTag,
					description: created.description,
					message: `Successfully created tag "${created.tagName}"`
				};
			}
		)
	});
}

const UseTagSchema = z.object({
	name: z.string().describe('Name of the tag to switch to'),
	projectRoot
});

export function registerUseTagTool(server: FastMCP) {
	server.addTool({
		name: 'use_tag',
		description: 'Switch to a different tag context for task operations',
		parameters: UseTagSchema,
		annotations: { title: 'Use Tag', destructiveHint: true },
		execute: tagTool<z.infer<typeof UseTagSchema>>(
			'Error switching tag',
			async (args, tmCore) => {
				const result = await tmCore.tasks.useTag(args.name);
				return {
					tagName: result.currentTag,
					switched: result.switched,
					previousTag: result.previousTag,
					taskCount: result.taskCount,
					message: `Successfully switched to tag "${result.currentTag}"`
				};
			}
		)
	});
}

const DeleteTagSchema = z.object({
	name: z.string().describe('Name of the tag to delete'),
	yes: z
		.boolean()
		.optional()
		.describe('Skip confirmation prompts (default: true for MCP)'),
	projectRoot
});

export function registerDeleteTagTool(server: FastMCP) {
	server.addTool({
		name: 'delete_tag',
		description: 'Delete an existing tag and all its tasks',
		parameters: DeleteTagSchema,
		annotations: { title: 'Delete Tag', destructiveHint: true },
		// MCP never asks: `yes` is accepted for older clients
		execute: tagTool<z.infer<typeof DeleteTagSchema>>(
			'Error deleting tag',
			async (args, tmCore) => {
				const result = await tmCore.tasks.deleteTag(args.name);
				if (!result.deleted) throw new Error('Tag deletion was cancelled');
				return {
					tagName: result.tagName,
					deleted: result.deleted,
					tasksDeleted: result.tasksDeleted,
					wasCurrentTag: result.wasCurrentTag,
					switchedToMaster: result.switchedToMaster,
					message: `Successfully deleted tag "${result.tagName}"`
				};
			}
		)
	});
}

const RenameTagSchema = z.object({
	oldName: z.string().describe('Current name of the tag to rename'),
	newName: z.string().describe('New name for the tag'),
	projectRoot
});

export function registerRenameTagTool(server: FastMCP) {
	server.addTool({
		name: 'rename_tag',
		description: 'Rename an existing tag',
		parameters: RenameTagSchema,
		annotations: { title: 'Rename Tag', destructiveHint: true },
		execute: tagTool<z.infer<typeof RenameTagSchema>>(
			'Error renaming tag',
			async (args, tmCore) => {
				const result = await tmCore.tasks.renameTag(args.oldName, args.newName);
				return {
					oldName: result.oldName,
					newName: result.newName,
					renamed: result.renamed,
					taskCount: result.taskCount,
					wasCurrentTag: result.wasCurrentTag,
					message: `Successfully renamed tag from "${result.oldName}" to "${result.newName}"`
				};
			}
		)
	});
}

const CopyTagSchema = z.object({
	sourceName: z.string().describe('Name of the source tag to copy from'),
	targetName: z.string().describe('Name of the new tag to create'),
	description: z
		.string()
		.optional()
		.describe('Optional description for the new tag'),
	projectRoot
});

export function registerCopyTagTool(server: FastMCP) {
	server.addTool({
		name: 'copy_tag',
		description:
			'Copy an existing tag to create a new tag with all tasks and metadata',
		parameters: CopyTagSchema,
		annotations: { title: 'Copy Tag', destructiveHint: false },
		execute: tagTool<z.infer<typeof CopyTagSchema>>(
			'Error copying tag',
			async (args, tmCore) => {
				const result = await tmCore.tasks.copyTag(
					args.sourceName,
					args.targetName,
					{ description: args.description }
				);
				return {
					sourceName: result.sourceName,
					targetName: result.targetName,
					copied: result.copied,
					description: result.description,
					message: `Successfully copied tag from "${result.sourceName}" to "${result.targetName}"`
				};
			}
		)
	});
}
