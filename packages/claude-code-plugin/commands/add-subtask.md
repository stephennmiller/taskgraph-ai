---
description: "TaskGraph: add a subtask to a task. Use when a TaskGraph task needs a smaller step."
argument-hint: "<parent ID> <title>"
---

Add a subtask to a task.

Arguments: $ARGUMENTS (parent task ID, then the subtask's title)

1. Use the parent ID only when it is digits. If it is missing, ask which task. Put the title in single quotes, with any `'` written as `'\''`:

   ```bash
   taskgraph add-subtask --parent=<id> --title='<title>'
   ```

   Add `--description='<text>'` if the user described more than a title, and `--dependencies=<ids>` for sibling subtasks it waits on (`5.1`; digits, dots and commas only). For several subtasks ("setup, implement, test"), run it once per title. To make an existing task a subtask, use `/taskgraph:convert-task-to-subtask`.
2. Show the output unchanged in a code block, then run `taskgraph show <parent-id>` and show its subtask list.
