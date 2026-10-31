---
description: "TaskGraph: have Claude Code work through the tasks one after another, one task per run."
argument-hint: "[number of tasks] [task ID] [preset] [parallel <n>] [sandbox]"
---

Run `taskgraph loop`: Claude Code works the next ready task, marks it done, and starts a new run on the next one.

Usage: `/taskgraph:loop [<n>] [<id>] [tdd|test-coverage|linting|duplication|entropy] [parallel <n>] [sandbox]`

Arguments: $ARGUMENTS

1. Build the command from the arguments, using numbers and IDs only when they are digits and dots:
   - a number on its own → `--iterations=<n>`, the most tasks to work
   - a task ID (`5`, `5.2`) → `--id=<id>`, work that task instead of the next one
   - a preset name (`default`, `tdd`, `test-coverage`, `linting`, `duplication`, `entropy`) → `--prompt=<preset>`
   - `parallel <n>` → `--parallel=<n>` (1-16), each ready task in its own git worktree and branch
   - `sandbox` → `--sandbox`, each run in Docker

   ```bash
   taskgraph loop --iterations=<n>
   ```

2. Without `sandbox`, each run has permission prompts off: it can read, edit and run anything in this project without asking. Tell the user that, with the command you'll run, and go on only once they agree. Then add `--trust`; `loop` can't ask for itself from here.
3. A run takes minutes per task, so run the command in the background and tell the user it started. The user can run the same command in their own terminal instead, to watch each run.
4. When it finishes, show the summary it printed: each task it worked and its status. Then suggest `/taskgraph:list` to see where the plan stands.
