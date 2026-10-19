/**
 * @fileoverview Graph Slash Command
 * Show tasks as a dependency tree.
 */

import { dynamicCommand } from '../../factories.js';

/**
 * The graph slash command - Dependency Graph
 *
 * Show tasks as a dependency tree.
 */
export const graph = dynamicCommand(
	'graph',
	'Dependency Graph',
	'[task-id]',
	`Show the project's tasks as a dependency tree.

Arguments: $ARGUMENTS

1. If the arguments contain a task ID, run \`taskgraph graph --id=<id>\` to show that task and everything that depends on it. Otherwise run \`taskgraph graph\`.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, point out what stands out: the task marked "← next", anything in progress, and any task listed as missing a dependency or stuck in a dependency loop, with the fix command the output suggests.`
);
