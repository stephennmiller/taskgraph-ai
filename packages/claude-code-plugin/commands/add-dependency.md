---
description: "TaskGraph: make one task wait on another. Use when a task can't start until another is done."
argument-hint: "<task ID> <depends-on ID>"
---

Make one task wait on another.

Arguments: $ARGUMENTS (the task, then the task it waits on: "5 3", "5 needs 3", "5 after 3")

1. Read both IDs from the arguments; use them only when they are digits and dots. If it isn't clear which task waits on which, ask.
2. Run:

   ```bash
   taskgraph add-dependency --id=<task-id> --depends-on=<dependency-id>
   ```

   When the tasks are only connected ("5 is related to 3", "found 5 while doing 3"), link them without making one wait: add `--type=related` or `--type=discovered-from`. Those links never hold up `next`.
3. Show the output unchanged in a code block. The command refuses a dependency that would make a loop; if it does, say which tasks form it.
