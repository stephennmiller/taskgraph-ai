---
description: Guidelines for implementing task management operations
paths:
  - "packages/tm-core/src/modules/tasks/**"
---

# Task management in @tm/core

How the tasks module is laid out and how it reads and writes `tasks.json`.
ID types and the bugs reviews keep finding are in
[robustness.md](robustness.md); dependencies are in
[dependencies.md](dependencies.md); status rules are in
[state-machines.md](state-machines.md).

## Layout

- `tasks-domain.ts` is the facade the CLI and MCP call as `tmCore.tasks`.
  It hands each call to `tasks-status-commands.ts` (status and the done
  gate), `tasks-edit-commands.ts` (no-AI edits) or `tasks-ai-commands.ts`
  (add, expand, scope, research, update, parse-prd, analyze-complexity).
  A new AI command goes in `tasks-ai-commands.ts`.
- `services/` hold the work that needs storage or the AI; `utils/` hold
  pure functions on a tag's `Task[]` (`task-removal.ts`, `task-moves.ts`,
  `parent-status.ts`, `next-task.ts`). Put new logic in a pure function and
  test it there.

## Reading and writing tasks.json

- Go through `IStorage` (`common/interfaces/storage.interface.ts`), never
  `fs` on `tasks.json`. Change tasks with a locked read-modify-write:
  `modifyTask` for one task or subtask, `appendTasks` for new ones,
  `mutateTags` for a change that spans tags. A throw leaves the file
  unchanged.
- The lock, the file format and how new IDs are handed out are in sections
  4 to 6 of [state-machines.md](state-machines.md).

## Changing tasks

Parent status from subtasks is section 2 of
[state-machines.md](state-machines.md); keeping fields an AI rewrite drops
is in [robustness.md](robustness.md) (`keepStoredFields` in
`utils/stored-fields.ts`).
