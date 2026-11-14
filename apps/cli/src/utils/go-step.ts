/**
 * @fileoverview The mark `go` puts on the steps it runs before `loop`
 * (#1146). Internal: nothing a user sets.
 */

/** Set to `1` on a step of `go`: it prints its result and no next step, since `go` runs the next step itself */
export const GO_STEP_ENV = 'TASKGRAPH_GO_STEP';

export const isGoStep = () => process.env[GO_STEP_ENV] === '1';
