---
description: "TaskGraph: have Claude Code work through the tasks one after another, committing after each."
argument-hint: "[number of runs] [task ID] [preset] [parallel <n>] [sandbox] [dry-run]"
---

Run `taskgraph loop`: Claude Code finishes one ready task per session, marking it done and committing it, then a fresh session takes the next. Stopped, it picks up where it left off.

Usage: `/taskgraph:loop [<n>] [<id>] [tdd|test-coverage|linting|duplication|entropy] [parallel <n>] [sandbox] [dry-run]`

Arguments: $ARGUMENTS

1. Build the command from the arguments, using numbers and IDs only when they are digits and dots:
   - a number on its own → `--iterations=<n>`, the most runs
   - a task ID (`5`, `5.2`) → `--id=<id>`, work that task instead of the next one
   - a preset name (`default`, `tdd`, `test-coverage`, `linting`, `duplication`, `entropy`) → `--prompt=<preset>`
   - `parallel <n>` → `--parallel=<n>` (1-16), each ready task in its own git worktree and branch. It runs alone: `loop` refuses it with a number, a task ID, a preset or `sandbox`, so if the arguments mix them, ask which the user wants
   - `sandbox` → `--sandbox`, each run in Docker
   - `dry-run` → `--dry-run`: it prints the tasks the run would work, in order, with each one's model and effort, and starts nothing. Run it in the foreground without `--trust`, show what it printed, and stop; it refuses `parallel`

   ```bash
   taskgraph loop --iterations=<n>
   ```

2. Without `sandbox`, each run has permission prompts off: it can read, edit and run anything in this project without asking. Tell the user that, with the command you'll run, and go on only once they agree. Then add `--trust`; `loop` can't ask for itself from here.
3. A run takes minutes per task and can work many tasks, so run the command in the background and tell the user it started. The user can run the same command in their own terminal instead, to watch each run.
4. When it finishes, show the summary it printed: each task it worked and its status. Then suggest `/taskgraph:list` to see where the plan stands.
