---
description: "TaskGraph: add a subtask to a task, or move a task under another. Use when a task needs a smaller step."
argument-hint: "<parent ID> <title or task ID>"
---

Add a subtask to a task, or move an existing task under it as a subtask.

Usage: `/taskgraph:add-subtask <parent ID> <title>` or `/taskgraph:add-subtask <parent ID> <task ID>`

Arguments: $ARGUMENTS (parent task ID, then the subtask's title, or the ID of the task to move: "5 8" or "move 8 under 5")

1. Use the parent ID only when it is digits and dots and names a top-level task (`5`, no dot). If it is missing, or it isn't clear which ID is the parent, ask.
2. When the rest of the arguments is a task ID (digits only, a top-level task like `8`), move that task under the parent:

   ```bash
   taskgraph add-subtask --parent=<parent-id> --task-id=<task-id>
   ```

   Show the output unchanged in a code block. Then, in one sentence, give the task's new subtask ID; tasks that depended on it now point at that ID.
3. Otherwise add a new subtask. Put the title in single quotes, with any `'` written as `'\''`:

   ```bash
   taskgraph add-subtask --parent=<id> --title='<title>'
   ```

   Add `--description='<text>'` if the user described more than a title, and `--dependencies=<ids>` for sibling subtasks it waits on (`5.1`; digits, dots and commas only). For several subtasks ("setup, implement, test"), run it once per title.

   Show the output unchanged in a code block, then run `taskgraph show <parent-id>` and show its subtask list.
