/**
 * @fileoverview Why Slash Command
 * Explain why a task is blocked.
 */

import { dynamicCommand } from '../../factories.js';

/**
 * The why slash command - Why Is This Task Blocked
 *
 * Follow a task's unfinished dependencies down to the root causes.
 */
export const why = dynamicCommand(
	'why',
	'Why Is This Task Blocked',
	'<task-id>',
	`Explain why a task can't be started.

Arguments: $ARGUMENTS

1. Run \`taskgraph why <id>\` with the task ID from the arguments. If there is none, ask which task.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, say what to do first: the task to work on, or the command the output suggests for a missing dependency, a deferred task or a dependency loop.`
);
