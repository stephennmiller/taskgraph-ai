---
description: "TaskGraph: set a task's status (pending, in-progress, review, done, deferred, cancelled, blocked)."
argument-hint: "<task ID> <status>"
---

Set a task's status.

Usage: `/taskgraph:set-status <id> <status>`

Arguments: $ARGUMENTS (task ID, then status)

`/taskgraph:to-in-progress <id>` and `/taskgraph:to-done <id>` stay as shortcuts for the two most common changes. Use this command for every other status.

## Statuses

- `pending` - Not yet started, or moved back to the start
- `in-progress` - Currently being worked on
- `done` - Completed and verified
- `review` - Work is complete but needs verification before final approval
- `deferred` - Valid, but postponed
- `cancelled` - No longer needed; kept for reference
- `blocked` - Waiting on external factors

If the status is missing or is not one of these, ask which one is meant before changing anything.

## Execution

```bash
taskgraph set-status --id=<id> --status=<status>
```

Put the IDs into the command only when they are digits and dots (`5`, `5.2`), or a comma-separated list of them (`5,6.1`); otherwise ask the user for the task ID.

## Per-status checks

- **pending**: warn if the task is in-progress, and check whether this blocks other tasks
- **review**: summarize key changes and test results, and note who should review
- **deferred**: record why, and the criteria for picking it up again
- **cancelled**: confirm no task depends on it, and record why
- **blocked**: record what the task is waiting on

## After the change

- Show the updated task
- List tasks this change unblocks, or now blocks
- Suggest the next task with `taskgraph next`
