---
description: "TaskGraph: delete the subtasks of one task, or of every task with --all."
argument-hint: "[<task ID>|--all]"
---

Clear all subtasks from a task, or from every task.

Usage: `/taskgraph:clear-subtasks [<id>|--all]`

Arguments: $ARGUMENTS (task ID, or `--all`)

To remove a single subtask, use `/taskgraph:remove-subtask` instead.

Remove all subtasks from a parent task at once.

## Clearing Subtasks

Bulk removal of all subtasks from a parent task.

## Execution

```bash
taskgraph clear-subtasks --id=<task-id>   # one task
taskgraph clear-subtasks --all            # every task, destructive
```

`--all` is never implied: run it only when the arguments say `--all`, and only after the user types `CLEAR ALL SUBTASKS` to confirm. If no ID and no `--all` are given, ask which tasks to clear. Put an ID into the command only when it is digits and dots (`5`, `5.2`); otherwise ask the user for the task ID.

## Pre-Clear Analysis

1. **Subtask Summary**
   - Number of subtasks
   - Completion status of each
   - Work already done
   - Dependencies affected

2. **Impact Assessment**
   - Data that will be lost
   - Dependencies to be removed
   - Effect on project timeline
   - Parent task implications

## Confirmation Required

```
Clear Subtasks Confirmation
━━━━━━━━━━━━━━━━━━━━━━━━━
Parent Task: #5 "Implement user authentication"
Subtasks to remove: 4
- #5.1 "Setup auth framework" (done)
- #5.2 "Create login form" (in-progress)
- #5.3 "Add validation" (pending)
- #5.4 "Write tests" (pending)

⚠️  This will permanently delete all subtask data
Continue? (y/n)
```

## Smart Features

- Option to convert to standalone tasks
- Backup task data before clearing
- Preserve completed work history
- Update parent task appropriately

## Process

1. List all subtasks for confirmation
2. Check for in-progress work
3. Remove all subtasks
4. Update parent task
5. Clean up dependencies

## Alternative Options

Suggest alternatives:
- Convert important subtasks to tasks
- Keep completed subtasks
- Archive instead of delete
- Export subtask data first

## Post-Clear

- Show updated parent task
- Recalculate time estimates
- Update task complexity
- Suggest next steps

## Example

```
/taskgraph:clear-subtasks 5
→ Found 4 subtasks to remove
→ Warning: Subtask #5.2 is in-progress
→ Cleared all subtasks from task #5
→ Updated parent task estimates
→ Suggestion: Consider re-expanding with better breakdown
```

## Clearing every task (`--all`)

Use with extreme caution. Before running it:

1. Summarize the project-wide impact: parent tasks, subtasks, and how many are in-progress or done.
2. Warn about in-progress work that will be lost.
3. Require the user to type `CLEAR ALL SUBTASKS` to confirm.

```
/taskgraph:clear-subtasks --all
→ This will remove ALL 47 subtasks, including 8 in-progress and 15 done
→ This cannot be undone. Type 'CLEAR ALL SUBTASKS' to confirm:
```

Valid reasons: project restructuring, a major change of approach, or starting a fresh breakdown. Consider clearing a single task first.
