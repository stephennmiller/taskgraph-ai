/**
 * @fileoverview archive_tasks MCP tool
 * Move done and cancelled tasks out of tasks.json, or restore one by ID
 */

import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const ArchiveTasksSchema = z.object({
	restore: z
		.string()
		.regex(/^\d+$/, 'A task ID like 12')
		.optional()
		.describe(
			'ID of an archived task to move back into tasks.json (with its subtasks). Omit to archive.'
		),
	olderThanDays: z
		.number()
		.int()
		.min(0)
		.optional()
		.describe(
			'Archive done/cancelled tasks last changed at least this many days ago (default: config global.archiveAfterDays, else 30)'
		),
	dryRun: z
		.boolean()
		.optional()
		.describe('List what would be archived without moving anything'),
	projectRoot: z
		.string()
		.describe('Absolute path to the project root directory'),
	tag: z.string().optional().describe('Tag context to operate on')
});

type ArchiveTasksArgs = z.infer<typeof ArchiveTasksSchema>;

const summarize = (task: { id: unknown; title: string; status: string }) => ({
	id: String(task.id),
	title: task.title,
	status: task.status
});

/**
 * Register the archive_tasks tool with the MCP server
 */
export function registerArchiveTasksTool(server: FastMCP) {
	server.addTool({
		name: 'archive_tasks',
		description:
			'Move done and cancelled tasks older than N days from tasks.json to .taskgraph/tasks/archive.json, or with restore, bring one back. Archived IDs are never reused; dependencies on archived tasks count as done.',
		parameters: ArchiveTasksSchema,
		annotations: {
			title: 'Archive Tasks',
			destructiveHint: false
		},
		execute: withToolContext(
			async (args: ArchiveTasksArgs, { log, tmCore }: ToolContext) => {
				const { restore, olderThanDays, dryRun, projectRoot, tag } = args;

				try {
					if (restore) {
						log.info(`Restoring archived task ${restore} in ${projectRoot}`);
						const result = await tmCore.tasks.restore(restore, { tag });
						return handleApiResult({
							result: {
								success: true,
								data: {
									restored: summarize(result.task),
									tag: result.tag
								}
							},
							log,
							projectRoot,
							tag
						});
					}

					log.info(`Archiving finished tasks in ${projectRoot}`);
					const result = await tmCore.tasks.archive({
						tag,
						olderThanDays,
						dryRun
					});
					return handleApiResult({
						result: {
							success: true,
							data: {
								[result.dryRun ? 'wouldArchive' : 'archived']:
									result.tasks.map(summarize),
								olderThanDays: result.olderThanDays,
								tag: result.tag
							}
						},
						log,
						projectRoot,
						tag
					});
				} catch (error: any) {
					log.error(`Error in archive_tasks: ${error.message}`);
					return handleApiResult({
						result: {
							success: false,
							error: {
								message: `Failed to ${restore ? `restore task ${restore}` : 'archive tasks'}: ${error.message}`
							}
						},
						log,
						projectRoot
					});
				}
			}
		)
	});
}
