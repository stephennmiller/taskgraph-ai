/**
 * @fileoverview The in-progress task a loop iteration starts on, when an
 * earlier run stopped on it and left uncommitted changes (#998)
 */

import type { TaskStatus } from '../../../common/types/index.js';
import type { InterruptedTask } from './loop-prompt.js';

/**
 * The pinned task, or the one `readyTask` gives, with the uncommitted files,
 * when it is in progress and the tree isn't clean
 */
export async function interruptedTask(
	pinned: string | undefined,
	readyTask: () => Promise<string | undefined>,
	statuses: Map<string, TaskStatus> | undefined,
	uncommittedFiles: (() => Promise<string[]>) | undefined
): Promise<InterruptedTask | undefined> {
	if (!uncommittedFiles || !statuses) return undefined;
	const taskId = pinned ?? (await readyTask());
	if (!taskId || statuses.get(taskId) !== 'in-progress') return undefined;
	// Not a git repository, or git failed: the header just leaves the line out
	const files = await uncommittedFiles().catch(() => []);
	return files.length > 0 ? { taskId, files } : undefined;
}
