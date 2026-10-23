---
description: "TaskGraph: claim a task by setting it in-progress. Use when starting work on a TaskGraph task."
argument-hint: "[task ID]"
---

Start working on a task by setting its status to in-progress.

Arguments: $ARGUMENTS (task ID)

## Starting Work on Task

This command does more than just change status - it prepares your environment for productive work.

## Pre-Start Checks

1. Verify dependencies are met
2. Check if another task is already in-progress
3. Ensure task details are complete
4. Validate test strategy exists

## Execution

```bash
taskgraph set-status --id=<id> --status=in-progress
```

Put the ID into the command only when it is digits and dots (`5`, `5.2`); otherwise ask the user for the task ID.

## Environment Setup

After setting to in-progress:
1. Create/checkout appropriate git branch
2. Open relevant documentation
3. Set up test watchers if applicable
4. Display task details and acceptance criteria
5. Show similar completed tasks for reference

## Smart Suggestions

- Estimated completion time based on complexity
- Related files from similar tasks
- Potential blockers to watch for
- Recommended first steps