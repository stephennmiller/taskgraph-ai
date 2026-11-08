---
description: Every state machine in TaskGraph, its states, invariants and transitions; update it when you change one
paths:
  - "packages/tm-core/src/modules/tasks/**"
  - "packages/tm-core/src/modules/storage/**"
  - "packages/tm-core/src/modules/loop/**"
  - "packages/tm-core/src/modules/github/**"
  - "packages/tm-core/src/modules/git/**"
  - "packages/tm-core/src/common/constants/**"
---

# State machines

TaskGraph has no state-machine library. Its machines live in a status
field, a few metadata keys, files on disk and git. This file lists each one,
the invariants the code relies on, and how it moves. When you change a
transition or add a writer, update the matching section in the same PR.

Paths are under `packages/tm-core/src/modules/` unless they say otherwise.

## Index

| #   | Machine                     | Where the state lives             |
| --- | --------------------------- | --------------------------------- |
| 1   | Task status                 | `task.status`                     |
| 2   | Parent status from subtasks | derived, written on parent        |
| 3   | Claim                       | `metadata.claimedBy`, `claimedAt` |
| 4   | Task ID                     | live IDs, archive `highestId`     |
| 5   | tasks.json write            | lock file, temp file              |
| 6   | File format                 | shape of tasks.json               |
| 7   | Serial loop run             | locals in `LoopService.run`       |
| 8   | Parallel task               | `ParallelTask.state`, `outcome`   |
| 9   | Merge waves                 | `runMergingWaves`                 |
| 10  | Loop trust                  | trust file, hash per project      |
| 11  | Task worktree               | git, recorded branch tip          |
| 12  | GitHub link                 | `metadata.github`                 |
| 13  | Auto-update                 | cache file, `update.lock`         |

## 1. Task status

States: `pending`, `in-progress`, `review`, `blocked`, `deferred`, `done`,
`cancelled`. A stored `completed` is read as `done`.

What each status means is one table, `TASK_STATUS_MEANINGS` in
`common/constants/index.ts`. Every status set (complete, pickable,
actionable, finished, active, open, importable) is derived from it. Never
write a status list or set by hand. A complete status satisfies a dependency
and counts toward progress; `next` and claims offer only pickable ones; the
loop counts a finished task as handled.

| Status      | complete | pickable | actionable | finished |
| ----------- | -------- | -------- | ---------- | -------- |
| pending     | no       | yes      | yes        | no       |
| in-progress | no       | yes      | yes        | no       |
| review      | no       | no       | yes        | yes      |
| blocked     | no       | no       | no         | no       |
| deferred    | no       | no       | no         | no       |
| done        | yes      | no       | no         | yes      |
| cancelled   | yes      | no       | no         | no       |

Transitions: any status to any other, through `TaskStatusCommands`
(`tasks/tasks-status-commands.ts`). People need that freedom, so there is
no transition table to enforce.

Guards and side effects:

- Moving to `done` runs the checklist gate (acceptance criteria and
  Definition of Done) and, in a loop, `loop.smokeCommand`. `force` skips
  both. GitHub pull always forces.
- Moving to `pending`, `blocked` or `deferred` clears the claim (machine 3).
- `update-task` and `update-subtask` never change a status. Only
  `set-status`, the loop, GitHub pull and the parallel runner do.

Invariants:

- A task's status is always one of the seven above.
- A `done` task passed the gate unless it was forced.

## 2. Parent status from subtasks

When a subtask's status changes, `setSubtaskStatusIn`
(`storage/adapters/file-storage/task-updates.ts`) recomputes the parent:

| Subtasks after the change      | Parent becomes                           |
| ------------------------------ | ---------------------------------------- |
| all complete, one or more done | done, or in-progress if its gate refuses |
| all cancelled                  | unchanged                                |
| any in-progress or done        | in-progress                              |
| all pending                    | pending (claim cleared)                  |
| other mixes                    | unchanged                                |

Invariants the rest of the code relies on:

- I1: a `done` parent has only complete subtasks. Dependents treat a done
  parent as satisfied, and `next` offers subtasks only of in-progress
  parents, so an open subtask under a done parent is never offered.
- I2: an `in-progress` parent has at least one open subtask. Claims and the
  loop never pick an in-progress task, so a parent whose subtasks are all
  complete stays stuck there.
- I3: a subtask has no subtasks.

Known breaks, tracked in #1042 and #1043:

- add-subtask, move into or out of a parent, remove-subtask,
  clear-subtasks and expand do not run the recompute, so they can break I1
  and I2.
- A parent in `review` is moved to done when its last subtask finishes.
- `add-subtask --task-id` of a task that has subtasks breaks I3.
- Converting between task and subtask drops `acceptanceCriteria` and other
  fields, which takes the work out from under the done gate.

`set-status <parent> done` with open subtasks is allowed on purpose: it is
an explicit user action.

## 3. Claim

A claim marks who is working on an in-progress task:
`metadata.claimedBy` and `metadata.claimedAt` (`tasks/utils/claim.ts`).

| From      | Event                                    | To                   |
| --------- | ---------------------------------------- | -------------------- |
| unclaimed | `next --claim`, parallel runner          | claimed, in-progress |
| claimed   | status to pending, blocked, deferred     | unclaimed            |
| claimed   | status to done, review, cancelled        | kept as a record     |
| claimed   | parallel settle: abort, failure, no work | unclaimed            |

Invariants:

- `claimNextInTasks` takes only unstarted tasks (`unstartedOnly`), and
  hides the subtasks of a task claimed by someone else.
- A claim is released only by the process that holds it or by a status
  change.

Known breaks, tracked in #1044:

- A claim does not record which process holds it. A `loop --parallel` that
  is killed hard (second Ctrl-C, SIGKILL, crash) leaves its tasks claimed
  and in-progress, and no later run can take them.
- `next` and the serial loop ignore claims, so they can hand out a task a
  parallel run is building.

## 4. Task ID

| From     | Event                     | To                 |
| -------- | ------------------------- | ------------------ |
| free     | add-task, parse-prd, move | live               |
| live     | archive                   | archived (ID kept) |
| archived | restore                   | live               |
| live     | remove-task, move off     | retired            |

Each tag records `metadata.highestId`, the highest task ID it has ever
held, on every write (`applyTagUpdate` in `tag-update.ts`). `nextTaskId`
and `withFreeIds` hand out IDs above the highest of that mark, the live IDs
and the archive's `highestId`. That covers add-task, parse-prd (including
`--force`), `remove-task --convert`, GitHub import and moves between tags.
The merge driver merges the mark as a max and renumbers an incoming new
task whose ID this branch used and removed (#1040).

Invariant everything relies on: an ID names one task for its whole life.
The merge driver, GitHub link recovery and every in-flight AI write find a
task by ID only.

Known limits: `move --to=<id>` within a tag may name a removed ID on
purpose, and subtask IDs within a parent can still be reused.

## 5. tasks.json write

`storage/adapters/file-storage/file-operations.ts`:

| From    | Event                              | To                        |
| ------- | ---------------------------------- | ------------------------- |
| idle    | write requested                    | queued (in-process queue) |
| queued  | `proper-lockfile` acquired         | locked                    |
| locked  | re-read, modify, temp file, rename | written                   |
| locked  | modifier throws                    | idle, file unchanged      |
| written | `afterWrite`, unlock               | idle                      |

Invariants:

- Every writer goes through `mutateTasks`, `mutateTags` or
  `modifyTagged`, which re-read under the lock. AI results merge into what
  is on disk at write time.
- A write is all or nothing: temp file, then rename.
- Lock order is always tasks.json, then archive.json.

A 4-process stress run (20 mixed writes each) lost no update.

## 6. File format

| From            | Event                | To                  |
| --------------- | -------------------- | ------------------- |
| missing or `{}` | first write          | tagged              |
| standard        | write to master      | standard            |
| standard        | write to another tag | tagged, master kept |
| any             | write                | schemaVersion >= 2  |

IDs are saved as strings. The git merge driver
(`git/merge-driver/merge-tasks-json.ts`) is a pure three-way merge that
matches tasks by ID; an ID both sides added is renumbered on the incoming
side with its references.

## 7. Serial loop run

`loop/services/loop.service.ts`, `LoopService.run`.

Iteration result: `success`, `blocked`, `error`, `complete`. Final status:
`all_complete`, `max_iterations`, `budget_reached`, `blocked`, `error`.

| From      | Event                          | To                      |
| --------- | ------------------------------ | ----------------------- |
| iterating | `complete`, nothing ready      | all_complete            |
| iterating | `complete`, a task still ready | iterating (as success)  |
| iterating | `blocked`, a task ready        | iterating               |
| iterating | 3 errors or 2 stalls in a row  | task blocked, iterating |
| iterating | nothing ready after that       | error                   |
| iterating | trust withdrawn                | `TRUST_LOST`            |
| iterating | resume fails with 0 turns      | retried fresh           |
| iterating | budget or iteration cap        | budget or iteration end |

Invariants:

- An approved run checks trust before each iteration.
- A retried iteration never applies a status twice: the fresh retry runs
  only when the resumed one did no turns.
- An interrupted task is picked up again by `interruptedTask`.
- The progress file only appends. tasks.json is the source of truth.

## 8. Parallel task

`loop/parallel/parallel-runner.ts`, `outcome.ts`.

`state`: `running`, then `done` (exit 0), `failed` or `stopped`. When the
process is gone, settle sets one `outcome`:

| state   | worktree             | outcome           |
| ------- | -------------------- | ----------------- |
| done    | removed              | no-changes        |
| done    | kept                 | kept              |
| stopped | kept                 | stopped           |
| failed  | removed              | failed            |
| failed  | kept, claim released | released          |
| failed  | kept, still claimed  | failed-kept       |
| any     | container may run    | container-running |

With `--merge`, the wave then moves a kept task to `merged`, `set-aside`
(task back to pending), `conflict` (run ends) or `unmerged` (uncommitted
work). The CLI only maps outcome to text.

Invariant: settle releases the claim on abort, failure, or no work.

## 9. Merge waves

`loop/parallel/wave-merge.ts`, `runMergingWaves`:

| From       | Event                         | To                      |
| ---------- | ----------------------------- | ----------------------- |
| wave start | run tasks                     | each task settled       |
| settled    | merge clean                   | merged, task done       |
| settled    | conflict, resolver succeeds   | merged, task done       |
| settled    | conflict, set aside           | set-aside, task pending |
| settled    | conflict, cannot set aside    | run ends                |
| wave end   | nothing merged, abort, budget | run ends                |

Invariants (#1039):

- An approved run checks trust before each wave, before it claims
  anything, and stops with `TRUST_LOST` (exit 1) once the approval is
  withdrawn, like the serial loop.
- After an abort it does no new work: the abort is checked before each
  merge and before each resolver session, an aborted resolver is killed,
  and the run reports aborted (exit 130). A merge that already succeeded
  still marks its task done.

## 10. Loop trust

`loop/loop-trust.ts`. States: untrusted, trusted (hash of tasks and
instructions). `trustLoop` sets it, `keepLoopTrust` rolls the hash forward
between iterations, `untrustLoop` removes it (github import and
`parse-prd --append` call it). The file is written under a lock with an
atomic rename.

## 11. Task worktree

`loop/parallel/task-worktrees.ts`. A task's worktree goes from absent to
created or reused, then kept, removed, merged or renamed aside. The branch
tip is recorded under `.git/taskgraph/branches/<branch>`.
`assertBranchReusable` refuses a branch whose tip is neither the base nor
the recorded tip.

## 12. GitHub link

`github/`. A task's `metadata.github` holds the issue number,
`lastPushedStatus`, `bodyHash`, assignee and an `imported` flag.

Pull (`pull-planner.ts`) is a three-way merge against `lastPushedStatus`:

| Local vs base | Remote vs base      | Plan                         |
| ------------- | ------------------- | ---------------------------- |
| same          | same                | skip                         |
| changed       | same                | skip (local wins until push) |
| changed       | changed to the same | sync                         |
| same          | changed             | apply (forced)               |
| changed       | changed, differs    | conflict, local kept         |

Push runs in two passes: create every missing issue, then update bodies
and state. Links are recovered by a `(tag, id)` marker in the issue body.

Invariant: `lastPushedStatus` is the status GitHub holds for the issue.
Pass 1 records the status of the issue it created or recovered, and pass 2
records the task's status once it has written it, so a push cut off between
the passes never makes a pull revert the task (#1041).

Known break, tracked in #1040: ID reuse lets a new task recover a removed
task's link.

## 13. Auto-update

`apps/cli/src/utils/auto-update/`: check (cached for an hour, ten minutes
after a failure), take `update.lock` (`O_EXCL`, a stale lock is taken
over), `npm i -g`, restart with the skip flag set. MCP server start is
idempotent; SIGINT and SIGTERM stop it.
