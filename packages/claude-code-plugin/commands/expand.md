---
description: "TaskGraph: break a task, or every task with all, into subtasks. Use when a task is too big for one go."
argument-hint: "<task ID>|all [number of subtasks] [research]"
---

Break one task, or every open task without subtasks, into subtasks with AI.

Usage: `/taskgraph:expand <id> [number] [research]` or `/taskgraph:expand all [research]`

Arguments: $ARGUMENTS (task ID or `all`, then optional modifiers)

1. Pick the command from the arguments:
   - a task ID: use it only when it is digits and dots and names a top-level task (`5`). Run:

     ```bash
     taskgraph expand --id=<id>
     ```

     Add flags from the arguments: a number → `--num=<n>`; any other words → `--prompt='<words>'` (single quotes, any `'` written as `'\''`). If the task already has subtasks, the new ones are added after them.
   - `all` or `--all`: run:

     ```bash
     taskgraph expand --all
     ```

     It expands every pending or in-progress task that has no subtasks yet, using the scores from `/taskgraph:analyze-complexity` when a report exists.
   - neither: ask which task, or whether to expand all of them.

   Add `--research` if the arguments say `research`. `--force` replaces existing subtasks (with `--all`, it re-expands tasks that already have them), so add it only when the user asks.
2. Show the subtask lines it printed, or, for `all`, the summary: tasks expanded and subtasks added. Each subtask has 2-5 acceptance criteria of its own, all unchecked; `/taskgraph:to-done <id>` checks them against your changes.
3. Then suggest starting the first subtask: `taskgraph next`.
