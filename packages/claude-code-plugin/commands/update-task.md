---
description: "TaskGraph: change one task's details, with AI. Use when a TaskGraph task's plan changed."
argument-hint: "<task ID> <changes>"
---

Rewrite one task's description, details and test strategy with AI.

Arguments: $ARGUMENTS (task ID, then what changed: "5 add rate limiting")

This changes one task's content only. For other requests, say so and use the right command:

- several tasks at once, or "all tasks that ...": `/taskgraph:update`
- a status ("mark 23 as done", "defer 7"): `/taskgraph:set-status <id> <status>`, or `/taskgraph:to-done <id>`, which checks the acceptance criteria first
- dependencies: `/taskgraph:add-dependency` and `/taskgraph:remove-dependency`
- a progress note, kept as written with no AI: `taskgraph note <id> -- '<text>'`

1. Use the ID only when it is digits and dots (`5`, or a subtask like `5.2`); otherwise ask which task. Put the changes in single quotes, with any `'` written as `'\''`:

   ```bash
   taskgraph update-task --id=<id> --prompt='<changes>'
   ```

   `update-task` takes a top-level task only. For a subtask (digits with one dot, `5.2`), run `taskgraph update-subtask --id=<id> --prompt='<changes>'`, which adds the changes to the subtask's details with a timestamp.

   Add `--research` if the user asks for research. The CLI refuses a task that is already done.
2. Show the output unchanged in a code block, then, in one sentence, what changed in the task.
