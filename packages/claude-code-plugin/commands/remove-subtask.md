---
description: "TaskGraph: remove a subtask, or turn it into its own task."
argument-hint: "<id> [--convert]"
---

Remove a subtask from its parent task.

Usage: `/taskgraph:remove-subtask <id> [--convert]`

Arguments: $ARGUMENTS

This removes one subtask. To clear every subtask of a task, or of all tasks, use `/taskgraph:clear-subtasks`.

Parse subtask ID to remove, with option to convert to standalone task.

## Removing Subtasks

Remove a subtask and optionally convert it back to a standalone task.

## Argument Parsing

- "remove subtask 5.1"
- "delete 5.1"
- "5.1 --convert" or "convert 5.1 to task" → remove and convert
- "5.1 standalone" → convert to standalone

## Execution Options

### 1. Delete Subtask
```bash
taskgraph remove-subtask --id=<parentId.subtaskId>
```

### 2. Convert to Standalone
```bash
taskgraph remove-subtask --id=<parentId.subtaskId> --convert
```

Put each ID into the command only when it is digits and dots (`5`, `5.2`); otherwise ask the user for the task ID.

## Pre-Removal Checks

1. **Validate Subtask**
   - Verify subtask exists
   - Check completion status
   - Review dependencies

2. **Impact Analysis**
   - Other subtasks that depend on it
   - Parent task implications
   - Data that will be lost

## Removal Process

### For Deletion:
1. Confirm if subtask has work done
2. Update parent task estimates
3. Remove subtask and its data
4. Clean up dependencies

### For Conversion:
1. Assign new standalone task ID
2. Preserve all task data
3. Update dependency references
4. Maintain task history

## Smart Features

- Warn if subtask is in-progress
- Show impact on parent task
- Preserve important data
- Update related estimates

## Example Flows

```
/taskgraph:remove-subtask 5.1
→ Warning: Subtask #5.1 is in-progress
→ This will delete all subtask data
→ Parent task #5 will be updated
Confirm deletion? (y/n)

/taskgraph:remove-subtask 5.1 convert
→ Converting subtask #5.1 to standalone task #89
→ Preserved: All task data and history
→ Updated: 2 dependency references
→ New task #89 is now independent
```

## Post-Removal

- Update parent task status
- Recalculate estimates
- Show updated hierarchy
- Suggest next actions