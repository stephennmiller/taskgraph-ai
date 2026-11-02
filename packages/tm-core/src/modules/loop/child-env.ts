/**
 * @fileoverview Environment for a process `loop` starts.
 *
 * Claude Code (and anything it runs, including `taskgraph`) inherits this.
 * The marker says which parent started it. TASKGRAPH_SKIP_AUTO_UPDATE=1 is
 * always set too, so the update check is off even if the marker is ignored.
 */

import {
	LOOP_CHILD_ENV,
	PARALLEL_WORKER_ENV,
	SKIP_AUTO_UPDATE_ENV
} from '../../common/constants/auto-update.js';
import { NO_TASK_DATA_FENCE_ENV } from '../config/services/project-env.js';

/**
 * `loop` or one parallel worker.
 * The task-data fence opt-out is removed: Claude and the `taskgraph` it
 * runs must keep the fences even when the parent shell turned them off.
 */
export function childAutoUpdateEnv(
	kind: 'loop' | 'parallel',
	base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		...base,
		[kind === 'loop' ? LOOP_CHILD_ENV : PARALLEL_WORKER_ENV]: '1',
		[SKIP_AUTO_UPDATE_ENV]: '1'
	};
	delete env[NO_TASK_DATA_FENCE_ENV];
	return env;
}
