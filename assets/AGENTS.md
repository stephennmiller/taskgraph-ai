# TaskGraph

This project tracks work in TaskGraph. Run `taskgraph prime` for the task in progress, what's ready next, and the workflow rules; follow those rules. A Claude Code session with the TaskGraph plugin gets this at startup.

## Daily commands

- `taskgraph next`: the next task to work on
- `taskgraph show <id>`: one task in detail (`3`, or a subtask like `3.2`)
- `taskgraph list`: all tasks, filtered by `--status` or `--tag`
- `taskgraph set-status --id=<id> --status=in-progress`: claim a task (`--status=done` when finished)
- `taskgraph add-task --prompt="<what>"`: add a task

Statuses: pending, in-progress, review, done, deferred, cancelled, blocked. Subtask IDs have one dot (`3.2`). Change tasks through the commands, not by editing `.taskgraph/tasks/tasks.json`. `taskgraph --help` lists the rest.
