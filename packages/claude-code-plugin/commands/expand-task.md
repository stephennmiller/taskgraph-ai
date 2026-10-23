---
description: "TaskGraph: break one task into subtasks. Use when a TaskGraph task is too big to do in one go."
argument-hint: "<task ID> [number of subtasks] [research]"
---

Break one task into subtasks with AI.

Arguments: $ARGUMENTS (task ID, then optional modifiers)

1. Use the ID only when it is digits; if there is none, ask which task. Then run:

   ```bash
   taskgraph expand --id=<id>
   ```

   Add flags from the arguments: a number → `--num=<n>`; `research` → `--research`; any other words → `--prompt='<words>'` (single quotes, any `'` written as `'\''`). If the task already has subtasks, the new ones are added after them; `--force` replaces them instead, so add it only when the user asks.
2. Show the subtask lines it printed. Each subtask has 2-5 acceptance criteria of its own, all unchecked; `/taskgraph:to-done <id>` checks them against your changes.
3. Then suggest starting the first subtask: `taskgraph next`.
