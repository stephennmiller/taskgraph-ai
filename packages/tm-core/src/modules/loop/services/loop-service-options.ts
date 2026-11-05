/**
 * @fileoverview The lookups LoopService takes from the domain: tasks, git and complexity scores, each optional
 */

import type { TaskStatus } from '../../../common/types/index.js';

export interface LoopServiceOptions {
	projectRoot: string;
	/** The task `taskgraph next` would pick in a tag, checked before a run ends as all_complete */
	findReadyTask?: (tag?: string) => Promise<string | undefined>;
	/** Each task's and subtask's status in a tag, compared around every iteration */
	taskStatuses?: (tag?: string) => Promise<Map<string, TaskStatus>>;
	/** The commit HEAD points at (null if none), so a commit counts as progress on a task that takes several iterations */
	headCommit?: () => Promise<string | null>;
	/** A task's complexity score, which picks the iteration's model and effort */
	taskComplexity?: (id: string, tag?: string) => Promise<unknown>;
	/** Set a stuck task to blocked with a note saying why, so the run can move on */
	blockTask?: (id: string, note: string, tag?: string) => Promise<void>;
}
