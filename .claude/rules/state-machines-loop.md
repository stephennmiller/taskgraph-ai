---
description: The loop's state machines (serial run, parallel task, merge waves, loop trust, task worktree); update it when you change one
paths:
  - "packages/tm-core/src/modules/loop/**"
---

# State machines: the loop

Machines 7 to 11 of [state-machines.md](state-machines.md), which has the
index and the rest. Paths are under `packages/tm-core/src/modules/`.

## 7. Serial loop run

`loop/services/loop.service.ts`, `LoopService.run`.

Iteration result: `success`, `blocked`, `error`, `complete`. Final status:
`all_complete`, `max_iterations`, `budget_reached`, `blocked`, `error`.

| From      | Event                          | To                      |
| --------- | ------------------------------ | ----------------------- |
| start     | every task done or cancelled   | all_complete, no run    |
| iterating | `complete`, nothing ready      | all_complete            |
| iterating | `complete`, a task still ready | iterating (as success)  |
| iterating | `blocked`, a task ready        | iterating               |
| iterating | 3 errors or 2 stalls in a row  | task blocked, iterating |
| iterating | nothing ready after that       | error                   |
| iterating | trust withdrawn                | `TRUST_LOST`            |
| iterating | resume fails with 0 turns      | retried fresh           |
| iterating | budget or iteration cap        | budget or iteration end |

Invariants:

- A task preset run over a tag whose tasks and subtasks are all done or
  cancelled starts no Claude Code session (#1160). A task in review, an
  empty tag, a pinned task and a prompt that picks its own work still run.
  The CLI asks `loop.nothingLeft` first, so such a run prints one line and
  no sign-in, approval question or intro; both use `allComplete`.
- An approved run checks trust before each iteration.
- A retried iteration never applies a status twice: the fresh retry runs
  only when the resumed one did no turns.
- An interrupted task is picked up again by `interruptedTask`.
- The progress file only appends. tasks.json is the source of truth.

`stopProcessGroup` stops every Claude Code the loop starts: SIGTERM to
its process group, SIGKILL after 5 seconds or once it exited.

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

Before wave 1 (#1124), a `review` task whose branch is at a tip
recorded as finished (machine 11) is merged like a settled one; other
`review` tasks are only listed (`leftInReviewIds`).

Invariants (#1039):

- An approved run checks trust before each wave, before it claims
  anything, and stops with `TRUST_LOST` (exit 1) once the approval is
  withdrawn.
- After an abort it does no new work: the abort is checked before each
  merge and before each resolver session, an aborted resolver is killed,
  and the run reports aborted (exit 130). A merge that already succeeded
  still marks its task done.

## 10. Loop trust

`loop/loop-trust.ts`. States: untrusted, trusted (hash of tasks and
instructions). `trustLoop` sets it, `keepLoopTrust` rolls the hash forward
between iterations, `untrustLoop` removes it (github import and
`parse-prd --append` call it). `go` asks before it plans, whatever is
stored (`isGoTrusted`), and stores a yes only when its loop step starts,
for the project root resolved then. The file is written under a lock with an
atomic rename.

## 11. Task worktree

`loop/parallel/task-worktrees.ts`. A task's worktree goes from absent to
created or reused, then kept, removed, merged or renamed aside. The branch
tip is recorded under `.git/taskgraph/branches/<branch>` (`finished`:
Claude Code exited 0).
`assertBranchReusable` refuses a branch whose tip is neither the base nor
the recorded tip, except when the run took over its own claimant's stale
claim (`TaskClaim.resumedFrom`): then a tip that descends from the recorded
one, checked out in the task's worktree, is the dead run's worker's work.
A worktree git still lists but whose folder was deleted by hand is pruned
and made again on its branch (#1104).
