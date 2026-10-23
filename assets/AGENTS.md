# TaskGraph

This project tracks work in TaskGraph. Run `taskgraph prime` for the task in progress, what's ready next, and the workflow rules; follow those rules. A Claude Code session with the TaskGraph plugin gets this at startup.

## Daily commands

- `taskgraph next`: the next task to work on
- `taskgraph show <id>`: one task in detail (`3`, or a subtask like `3.2`)
- `taskgraph list`: all tasks, filtered by `--status` or `--tag`. Piped, it prints one plain line per task: `3  pending  high  <title>  deps:1,2`
- `taskgraph set-status --id=<id> --status=in-progress`: claim a task (`--status=done` when finished)
- `taskgraph note <id> '<what you did>'`: log progress on a task as you go, saved as written
- `taskgraph add-task --prompt='<what>'`: add a task; add `--discovered-from=<id>` for work you found while doing task `<id>` (a link that doesn't block it)
- `taskgraph parse-prd <file> --clarify`: generate tasks from a PRD, asking about its gaps first. Agents: `--clarify --json` prints the questions; ask the user, add their answers to that JSON, write it to a file (not through a shell heredoc or echo) and pass `--answers <file>`

Put free text (a prompt, a note) in single quotes and write any `'` in it as `'\''`; in double quotes the shell runs backticks and `$(...)` in it.

Statuses: pending, in-progress, review, done, deferred, cancelled, blocked. Subtask IDs have one dot (`3.2`). Change tasks through the commands, not by editing `.taskgraph/tasks/tasks.json`. JSON output (`--json` or `--format json`) starts with a `schemaVersion` (now 1); a higher number means a key you read may have changed. `taskgraph --help` lists the rest.
