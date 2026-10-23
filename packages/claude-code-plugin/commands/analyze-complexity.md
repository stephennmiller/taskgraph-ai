---
description: "TaskGraph: score how complex each task is and which to break down. Use before expanding tasks."
argument-hint: "[task IDs] [research]"
---

Score each task's complexity with AI and recommend which to break into subtasks.

Arguments: $ARGUMENTS

1. Run:

   ```bash
   taskgraph analyze-complexity
   ```

   Add flags from the arguments: task IDs → `--id=<ids>` (digits and commas only); `research` → `--research`; a threshold → `--threshold=<n>`, a whole number from 1 to 10 (default 5).
2. Show the result lines it printed. The full report is saved under `.taskgraph/reports/`; `/taskgraph:complexity-report` shows it.
3. Then, in one sentence, name the tasks scored above the threshold and suggest `/taskgraph:expand-task <id>` for one, or `/taskgraph:expand-all-tasks` for all.
