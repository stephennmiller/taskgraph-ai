---
description: "TaskGraph: list the project's tasks, filtered by status or tag. Use when asked what tasks there are."
argument-hint: "[status] [--subtasks]"
---

List the project's tasks.

Usage: `/taskgraph:list-tasks [status] [--subtasks]`

Arguments: $ARGUMENTS

1. Pick the command from the arguments:
   - nothing: `taskgraph list`
   - a status (pending, in-progress, done, review, deferred, cancelled, blocked): `taskgraph list --status=<status>`. `blocked` means the task's status is `blocked`: `taskgraph list --status=blocked`
   - `subtasks` or `--subtasks`: add `--with-subtasks`, as in `taskgraph list --with-subtasks`
   - `ready`: `taskgraph list --ready`, the tasks whose dependencies are all done
   - `waiting` or "unmet dependencies": tasks that wait on another task, a different question from the `blocked` status. Run `taskgraph graph` instead; it draws each task under what it waits on.
   - task IDs like `1,3,5` (digits, dots and commas only): `taskgraph show 1,3,5`
2. Show the output unchanged in a code block.
3. Then, in one sentence, point out the `Next` task from the summary at the top of `list`, and anything in progress or blocked. `show` prints no summary, so after `show` point out only what it printed.
