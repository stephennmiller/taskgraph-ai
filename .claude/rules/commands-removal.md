---
description: Guidelines for CLI commands that delete or remove data
paths:
  - "apps/cli/src/commands/removal.command.ts"
---

# Removal and delete commands

The rest of the CLI command rules are in [commands.md](commands.md).
`remove-task`, `remove-subtask` and `clear-subtasks` live in
`removal.command.ts`; the removal itself is in `@tm/core`
(`TaskRemovalService` and `modules/tasks/utils/task-removal.ts`).

- **Check every ID first.** `tmCore.tasks.previewTaskRemoval` reports what
  each ID names. One unknown ID refuses the whole list, changes nothing and
  exits 1.
- **Confirm by default.** `remove-task` shows what will go
  (`printRemovalPlan`), then asks with an inquirer `confirm` that defaults
  to no. `-y, --yes` skips it. `remove-subtask` and `clear-subtasks` don't
  ask.
- **Without a terminal, require `--yes`.** A prompt there hangs scripts and
  agents, so print an error whose hint is `--yes` and exit 1.
- **tm-core cleans up.** It drops every dependency and link that pointed at
  what was removed (`modules/dependencies/removed-references.ts`), settles
  the parent's status, and deletes the removed tasks' generated files
  (`taskFileName`: `task_NNN.md`, or `task_NNN_<tag>.md` outside master)
  after `tasks.json` is saved. The command prints nothing of this itself.
  `tags remove`, `tags rename` and `archive` do the same for their files
  (`removeGeneratedTaskFiles`, `renameGeneratedTaskFiles`), matching only
  those names (#1125).
- **One result line.** `formatTasksRemoved` says what was removed and, when
  tasks still depend on missing ones, points to `taskgraph fix-dependencies`.
- **Partial failure exits 1.** When tasks were removed but a task file
  couldn't be deleted, say how many were removed and set
  `process.exitCode = 1`, so a retry doesn't report them as not found.
