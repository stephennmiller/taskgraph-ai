/**
 * @fileoverview Status-aware next-step suggestions
 * Dependency-free so both the CLI components and the legacy list renderer can share it
 */

export interface SuggestedAction {
	command: string;
	description: string;
}

/**
 * Pick next-step suggestions that fit the task's current status, so the CLI
 * never suggests starting a task that is already started, finished, or still
 * waiting on unfinished dependencies.
 * @param blocked - Something unfinished stands in the way (tm-core's explainBlockers)
 */
export function getSuggestedActions(
	taskId: string | number,
	status: string | undefined,
	hasSubtasks: boolean,
	blocked = false
): SuggestedAction[] {
	const id = String(taskId);
	const isSubtask = id.includes('.');
	const logProgress: SuggestedAction = {
		command: `taskgraph note ${id} '...'`,
		description: 'to log progress'
	};
	const expand: SuggestedAction[] =
		!isSubtask && !hasSubtasks
			? [
					{
						command: `taskgraph expand --id=${id}`,
						description: 'to break down into subtasks'
					}
				]
			: [];

	switch (status) {
		case 'in-progress':
			return [
				logProgress,
				{
					command: `taskgraph set-status ${id} done`,
					description: 'when it is finished'
				},
				...expand
			];
		case 'review':
			return [
				{
					command: `taskgraph set-status ${id} done`,
					description: 'once the review passes'
				},
				{
					command: `taskgraph set-status ${id} in-progress`,
					description: 'if it needs more work'
				}
			];
		case 'done':
		case 'cancelled':
			return [
				{
					command: 'taskgraph next',
					description: 'to find the next task to work on'
				}
			];
		case 'blocked':
		case 'deferred':
			return [
				{
					command: `taskgraph set-status ${id} pending`,
					description: 'when it is ready to pick up again'
				},
				logProgress
			];
		default:
			return [
				blocked
					? {
							command: `taskgraph why ${id}`,
							description: 'to see what it waits on'
						}
					: {
							command: `taskgraph set-status ${id} in-progress`,
							description: 'to start working'
						},
				...expand,
				logProgress
			];
	}
}
