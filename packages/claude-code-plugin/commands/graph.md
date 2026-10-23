---
description: "TaskGraph: show tasks as a dependency tree. Use to see what blocks what."
argument-hint: "[task-id]"
---

Show the project's tasks as a dependency tree.

Arguments: $ARGUMENTS

1. If the arguments contain a task ID, and only when it is digits and dots (`5`, `5.2`), run `taskgraph graph --id=<id>` to show that task and the tasks drawn under it. Otherwise run `taskgraph graph`.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, point out what stands out: the task marked "← next", the top bottleneck (`blocks N`), the critical path (`◆`), which tasks can run in parallel now (wave 1, named on the `N waves · N tasks can run now` line), any dependency marked `*` (chosen by the AI, so worth confirming), anything in progress, and any task listed as missing a dependency or stuck in a dependency loop, with the fix command the output suggests.
