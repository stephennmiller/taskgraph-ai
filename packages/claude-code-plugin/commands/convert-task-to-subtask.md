---
description: "TaskGraph: turn a task into a subtask of another task."
argument-hint: "<parent ID> <task ID>"
---

Move an existing task under another task as a subtask.

Arguments: $ARGUMENTS (the parent task ID, then the task to move: "5 8" or "move 8 under 5")

1. Read both IDs from the arguments; use them only when they are digits. If it isn't clear which is the parent, ask.
2. Run:

   ```bash
   taskgraph add-subtask --parent=<parent-id> --task-id=<task-id>
   ```

3. Show the output unchanged in a code block. Then, in one sentence, give the task's new subtask ID; tasks that depended on it now point at that ID.
