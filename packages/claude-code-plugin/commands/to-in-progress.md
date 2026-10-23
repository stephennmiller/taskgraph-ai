---
description: "TaskGraph: claim a task by setting it in-progress. Use when starting work on a TaskGraph task."
argument-hint: "[task ID]"
---

Start work on a task.

Arguments: $ARGUMENTS (task ID, e.g. `3` or a subtask like `3.2`)

1. Use the ID only when it is digits and dots. With no ID, ask which task, or whether to take the next one: `taskgraph next --claim` starts the task `next` picks.
2. Run:

   ```bash
   taskgraph set-status --id=<id> --status=in-progress
   taskgraph show <id>
   ```

3. Show the `show` output unchanged in a code block. Then, in one or two sentences, point out any dependency that isn't done (`/taskgraph:why <id>`) and the acceptance criteria the work has to meet. When the work is finished, close it with `/taskgraph:to-done <id>`.
