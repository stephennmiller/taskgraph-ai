---
description: "TaskGraph: remove a subtask, or turn it into its own task."
argument-hint: "<id> [--convert]"
---

Remove one subtask, or turn it into a task of its own.

Usage: `/taskgraph:remove-subtask <id> [--convert]`

Arguments: $ARGUMENTS (subtask ID like `5.1`; `--convert`, `convert` or `standalone` keeps it as a task)

To clear every subtask of a task, use `/taskgraph:clear-subtasks` instead.

1. Use the ID only when it is digits with one dot (`5.1`); otherwise ask which subtask.
2. Run one of:

   ```bash
   taskgraph remove-subtask --id=<parent.sub>            # delete it
   taskgraph remove-subtask --id=<parent.sub> --convert  # keep it as a task
   ```

   Deleting can't be undone: if the subtask is in progress or done, confirm with the user first, and offer `--convert`.
3. Show the output unchanged in a code block, including the new task ID after `--convert`.
