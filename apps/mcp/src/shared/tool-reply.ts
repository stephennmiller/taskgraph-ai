/**
 * @fileoverview The reply of a tool that runs one tm-core call: its data, or
 * the error it threw, in the shape handleApiResult gives every tool
 */

import path from 'node:path';
import { TASKGRAPH_TASKS_FILE } from '@tm/core';
import type { ToolContext } from './types.js';
import { handleApiResult } from './utils.js';

interface ToolArgs {
	projectRoot: string;
	tag?: string;
	file?: string;
}

/**
 * Run a tool's work and reply with its data, or with the error it threw.
 * `file` is kept for older clients; tasks live only in the project's
 * tasks.json, so another path is refused rather than ignored.
 */
export async function replyWith(
	args: ToolArgs,
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

/**
 * A task's ID as the legacy replies gave it: a number for a task ("3" -> 3),
 * a string for a subtask ("3.2"). tm-core stores and returns strings.
 */
export function replyId(id: string | number): string | number {
	return typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id;
}
