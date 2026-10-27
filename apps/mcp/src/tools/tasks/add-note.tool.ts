/**
 * @fileoverview add_note MCP tool
 * Append a progress note to a task or subtask as written, with no AI call
 */

import { neutralizeTaskData, TASK_DATA_NOTE, TaskIdSchema } from '@tm/core';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';
import type { ToolContext } from '../../shared/types.js';
import { handleApiResult, withToolContext } from '../../shared/utils.js';

const AddNoteSchema = z.object({
	id: TaskIdSchema.describe("Task or subtask ID (e.g., '15', '15.2')"),
	text: z
		.string()
		.describe(
			'The note, saved exactly as written: what you did, decided or found'
		),
	projectRoot: z
		.string()
		.describe('The directory of the project. Must be an absolute path.'),
	tag: z.string().optional().describe('Optional tag context to operate on')
});

type AddNoteArgs = z.infer<typeof AddNoteSchema>;

/**
 * Register the add_note tool with the MCP server
 */
export function registerAddNoteTool(server: FastMCP) {
	server.addTool({
		name: 'add_note',
		description:
			'Log progress on a task or subtask: appends your note to its details as written, with a timestamp. No AI call. Use it as you work; use set_task_status to change the status.',
		parameters: AddNoteSchema,
		annotations: {
			title: 'Add Note',
			destructiveHint: false
		},
		execute: withToolContext(
			async (args: AddNoteArgs, { log, tmCore }: ToolContext) => {
				const { id, text, projectRoot, tag } = args;
				try {
					const note = await tmCore.tasks.addNote(id, text, { tag });
					const kind = note.isSubtask ? 'subtask' : 'task';
					return handleApiResult({
						result: {
							success: true,
							data: neutralizeTaskData({
								message: `Added a note to ${kind} ${note.id}`,
								id: note.id,
								title: note.title,
								addedAt: note.addedAt
							})
						},
						log,
						projectRoot,
						tag,
						note: TASK_DATA_NOTE
					});
				} catch (error: unknown) {
					const err = error instanceof Error ? error : new Error(String(error));
					log.error(`Error in add-note: ${err.message}`);
					return handleApiResult({
						result: {
							success: false,
							error: { message: `Failed to add the note: ${err.message}` }
						},
						log,
						projectRoot,
						tag
					});
				}
			}
		)
	});
}
