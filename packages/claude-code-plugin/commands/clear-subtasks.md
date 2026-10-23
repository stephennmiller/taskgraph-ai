---
description: "TaskGraph: delete the subtasks of one task, or of every task with --all."
argument-hint: "[<task ID>|--all]"
---

Delete all the subtasks of one task, or of every task.

Usage: `/taskgraph:clear-subtasks [<id>|--all]`

Arguments: $ARGUMENTS (task ID, several as `5,6`, or `--all`)

To remove a single subtask, use `/taskgraph:remove-subtask` instead.

1. Use the ID only when it is digits and commas. If no ID and no `--all` are given, ask which task. For an ID, run `taskgraph show <id>` and tell the user how many subtasks will go, and how many of them are in progress or done.
2. Run:

   ```bash
   taskgraph clear-subtasks --id=<task-id>   # one task
   taskgraph clear-subtasks --all            # every task, destructive
   ```

   `--all` is never implied: run it only when the arguments say `--all`, and only after the user types `CLEAR ALL SUBTASKS` to confirm. Before asking, run `taskgraph list --with-subtasks` and say how many subtasks across how many tasks will go.
3. Show the output unchanged in a code block. To break the task down again, suggest `/taskgraph:expand-task <id>`.
