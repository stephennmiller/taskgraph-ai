---
description: "TaskGraph: show one task in full, with criteria and dependencies. Use for a task ID like 3 or 3.2."
argument-hint: "<task-id>"
---

Show a task in full.

Arguments: $ARGUMENTS

1. Run `taskgraph show <id>` with the task ID from the arguments: a task (`3`), a subtask (`3.2`), or several separated by commas (`3,5`). Use the IDs only when they are digits and dots, or a comma-separated list of them; otherwise, or if there is none, ask which task.
2. Show the output unchanged in a code block.
3. Then, in one or two sentences, point out what matters for working on it: dependencies that aren't done (`/taskgraph:why <id>` explains them) and acceptance criteria still unchecked.
