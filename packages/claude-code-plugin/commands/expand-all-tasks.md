---
description: "TaskGraph: break every pending task without subtasks into subtasks."
argument-hint: "[research]"
---

Break every open task that has no subtasks yet into subtasks with AI.

Arguments: $ARGUMENTS

1. Run:

   ```bash
   taskgraph expand --all
   ```

   It expands every pending or in-progress task that has no subtasks yet, using the scores from `/taskgraph:analyze-complexity` when a report exists. Add `--research` if the arguments say `research`. Add `--force` (re-expand tasks that already have subtasks, replacing them) only when the user asks for it.
2. Show the summary it printed: tasks expanded and subtasks added. Each new subtask has 2-5 acceptance criteria, all unchecked.
3. Then suggest `taskgraph next`.
