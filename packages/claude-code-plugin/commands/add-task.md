---
description: "TaskGraph: add a task to the plan. Use when the user asks to track, file or remember new work."
argument-hint: "<what the task is>"
---

Add a task to the plan.

Arguments: $ARGUMENTS (what the work is, in plain words)

1. Run `taskgraph add-task` with the request as the prompt, in single quotes with any `'` written as `'\''`:

   ```bash
   taskgraph add-task --prompt='<what the task is>'
   ```

   Add flags only for what the user said:
   - tasks it has to wait for: `--dependencies=<ids>` (digits, dots and commas only)
   - found while working on another task: `--discovered-from=<id>` (digits and dots only), which links them without blocking
   - a priority: `--priority=high`, `medium` or `low`
   - "research" or unfamiliar tech: `--research`
2. Show the output unchanged in a code block.
3. Then, in one sentence, point out the new task's ID and its acceptance criteria, which say what "done" means. If it looks too big for one sitting, suggest `/taskgraph:expand-task <id>`.
