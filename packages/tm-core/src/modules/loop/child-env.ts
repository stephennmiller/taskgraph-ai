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

/** `loop` or one parallel worker */
export function childAutoUpdateEnv(
	kind: 'loop' | 'parallel',
	base: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
	return {
		...base,
		[kind === 'loop' ? LOOP_CHILD_ENV : PARALLEL_WORKER_ENV]: '1',
		[SKIP_AUTO_UPDATE_ENV]: '1'
	};
}
