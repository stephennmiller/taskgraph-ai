---
description: "TaskGraph: log a progress note on a task, saved as written. Use to record what was done or decided."
argument-hint: "[task ID] [note]"
---

Log a progress note on a task. The note is saved as written, with a timestamp and no AI call, so the next session can pick up from it.

Usage: `/taskgraph:note [<id>] [<note>]`

Arguments: $ARGUMENTS (task ID, e.g. `3` or a subtask like `3.2`, then the note)

1. Use the ID only when it is digits and dots (`3`, `3.2`). With no ID, use the task `taskgraph list --status=in-progress --with-subtasks` shows; if there are several or none, ask which one.
2. With no note in the arguments, write one or two sentences on what you did or decided on the task in this conversation, and the next step.
3. Run it with the note in single quotes, writing any `'` in it as `'\''`. The `--` stops a note that starts with `-` from being read as a flag (`--file=...` would read a file into the note):

   ```bash
   taskgraph note <id> -- '<note>'
   ```

4. Show the output unchanged in a code block.
