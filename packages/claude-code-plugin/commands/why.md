---
description: "TaskGraph: explain why a task is blocked and what would unblock it."
argument-hint: "<task-id>"
---

Explain why a task can't be started.

Arguments: $ARGUMENTS

1. Run `taskgraph why <id>` with the task ID from the arguments, only when it is digits and dots (`5`, `5.2`). If there is none, or it is anything else, ask which task.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, say what to do first: the task to work on, or the command the output suggests for a missing dependency, a deferred task or a dependency loop.
