---
description: "TaskGraph: break one task into subtasks. Use when a TaskGraph task is too big to do in one go."
argument-hint: "[task ID]"
---

Break down a complex task into subtasks.

Arguments: $ARGUMENTS (task ID)

## Intelligent Task Expansion

Analyzes a task and creates detailed subtasks for better manageability.

## Execution

```bash
taskgraph expand --id=<id>
```

Put the ID into the command only when it is digits and dots (`5`, `5.2`); otherwise ask the user for the task ID.

## Expansion Process

1. **Task Analysis**
   - Review task complexity
   - Identify components
   - Detect technical challenges
   - Estimate time requirements

2. **Subtask Generation**
   - Create 3-7 subtasks typically
   - Each subtask 1-4 hours
   - Logical implementation order
   - Clear acceptance criteria

3. **Smart Breakdown**
   - Setup/configuration tasks
   - Core implementation
   - Testing components
   - Integration steps
   - Documentation updates

## Enhanced Features

Based on task type:
- **Feature**: Setup → Implement → Test → Integrate
- **Bug Fix**: Reproduce → Diagnose → Fix → Verify
- **Refactor**: Analyze → Plan → Refactor → Validate

## Acceptance criteria

Each new subtask comes with 2-5 acceptance criteria of its own, all unchecked. `taskgraph show <id>` numbers them, and `set-status done` refuses the subtask until every one is checked off with `taskgraph set-status --id=<id> --check <n>` (or `/taskgraph:to-done <id>`, which checks them against your changes first).

## Post-Expansion

After expansion:
1. Show subtask hierarchy
2. Update time estimates
3. Suggest implementation order
4. Highlight critical path