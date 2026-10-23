---
description: "TaskGraph: break every pending task that needs it into subtasks."
---

Expand all pending tasks that need subtasks.

## Bulk Task Expansion

Intelligently expands all tasks that would benefit from breakdown.

## Execution

```bash
taskgraph expand --all
```

## Smart Selection

Only expands tasks that:
- Are marked as pending
- Have high complexity (>5)
- Lack existing subtasks
- Would benefit from breakdown

## Expansion Process

1. **Analysis Phase**
   - Identify expansion candidates
   - Group related tasks
   - Plan expansion strategy

2. **Batch Processing**
   - Expand tasks in logical order
   - Maintain consistency
   - Preserve relationships
   - Optimize for parallelism

3. **Quality Control**
   - Ensure subtask quality
   - Avoid over-decomposition
   - Maintain task coherence
   - Update dependencies

## Options

- Add `force` to expand all regardless of complexity
- Add `research` for enhanced AI analysis

## Acceptance criteria

Each new subtask comes with 2-5 acceptance criteria of its own, all unchecked. `taskgraph show <id>` numbers them, and `set-status done` refuses the subtask until every one is checked off with `taskgraph set-status --id=<id> --check <n>` (or `/taskgraph:to-done <id>`, which checks them against your changes first).

## Results

After bulk expansion:
- Summary of tasks expanded
- New subtask count
- Updated complexity metrics
- Suggested task order