---
description: "TaskGraph: rewrite every task from an ID onward after a change of direction."
argument-hint: "<from ID> <what changed>"
---

Rewrite every task not yet done, from one ID onward, with AI after a change of direction.

Arguments: $ARGUMENTS (the first task ID, then what changed: "5 switch the database to PostgreSQL")

1. Use the ID only when it is digits; otherwise ask which task to start from. Tell the user which tasks will be rewritten (every task with that ID or higher that isn't done) and go on once they agree.
2. Put the change in single quotes, with any `'` written as `'\''`:

   ```bash
   taskgraph update --from=<id> --prompt='<what changed>'
   ```

   Add `--research` if the user asks for research.
3. Show the output unchanged in a code block. For a change to one task only, use `/taskgraph:update-task` instead.
