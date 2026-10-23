---
description: "TaskGraph: set a task's status (pending, in-progress, review, done, deferred, cancelled, blocked)."
argument-hint: "<task ID> <status>"
---

Set a task's status.

Usage: `/taskgraph:set-status <id> <status>`

Arguments: $ARGUMENTS (task ID, then status)

`/taskgraph:to-in-progress <id>` and `/taskgraph:to-done <id>` are the shortcuts for the two most common changes; `to-done` checks the acceptance criteria first. Use this command for every other status:

- `pending` - not started, or moved back to the start
- `in-progress` - being worked on
- `review` - work is complete and waits for review
- `done` - completed and verified
- `deferred` - valid, but postponed
- `cancelled` - no longer needed; kept for reference
- `blocked` - waiting on something outside the plan

Use the ID only when it is digits and dots (`3`, `3.2`, or several as `3,4`). If the status is missing or isn't one of these, ask which one is meant before changing anything.

1. Run:

   ```bash
   taskgraph set-status --id=<id> --status=<status>
   ```

   For `done`, `set-status` refuses while acceptance criteria are unchecked and lists them. Report that; pass `--force` only when the user says so.
2. For `deferred`, `cancelled` or `blocked`, save the user's reason on the task, in single quotes with any `'` written as `'\''`. `note` takes one ID, so run it once per task. The `--` stops a reason that starts with `-` from being read as a flag (`--file=...` would read a file into the note):

   ```bash
   taskgraph note <id> -- '<reason>'
   ```

3. Show the `set-status` output unchanged, then suggest `taskgraph next` for what to work on now.
