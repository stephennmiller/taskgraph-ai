/**
 * @fileoverview Env vars that keep a child process from installing an update.
 *
 * `loop` and `loop --parallel` set a marker on every process they start, and
 * always set TASKGRAPH_SKIP_AUTO_UPDATE=1 as well. The CLI refuses to install
 * when it sees either one, so a worker can't run `npm install -g` beside
 * another worker.
 */

/** Set to `1` on a process started by `loop` */
export const LOOP_CHILD_ENV = 'TASKGRAPH_LOOP_CHILD';

/** Set to `1` on a process started by `loop --parallel` */
export const PARALLEL_WORKER_ENV = 'TASKGRAPH_PARALLEL_WORKER';

/** Set to `1` to skip the update check entirely */
export const SKIP_AUTO_UPDATE_ENV = 'TASKGRAPH_SKIP_AUTO_UPDATE';
