---
description: "TaskGraph: remove a dependency between two tasks."
argument-hint: "<task ID> <depends-on ID>"
---

Remove a dependency, or a non-blocking link, between two tasks.

Arguments: $ARGUMENTS (the task, then the task it should no longer wait on: "5 3", "5 no longer needs 3")

1. Read both IDs from the arguments; use them only when they are digits and dots. If it isn't clear which is which, ask.
2. Run:

   ```bash
   taskgraph remove-dependency --id=<task-id> --depends-on=<dependency-id>
   ```

3. Show the output unchanged in a code block. Then run `taskgraph why <task-id>` and say in one sentence whether the task can start now.
