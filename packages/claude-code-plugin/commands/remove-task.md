---
description: "TaskGraph: delete a task permanently."
argument-hint: "<task ID>"
---

Delete a task, with its subtasks, permanently.

Arguments: $ARGUMENTS (task ID, e.g. `5`, a subtask like `5.2`, or several as `5,6`)

1. Use the ID only when it is digits, dots and commas; if there is none, ask which task.
2. Run `taskgraph show <id>` and tell the user what will go: the task's status, its subtasks, and the tasks that depend on it. Suggest `/taskgraph:set-status <id> cancelled` if they want to keep it for reference.
3. Only after the user confirms in the conversation, run:

   ```bash
   taskgraph remove-task --id=<id> --yes
   ```

   `--yes` skips the CLI's own prompt, which can't be answered here; the user's confirmation in step 2 replaces it.
4. Show the output unchanged in a code block. If tasks depended on it, suggest `/taskgraph:validate-dependencies`.
