# Build comparison

`compare-builds.mjs` runs one scenario of CLI commands against two builds and
reports where they differ: exit codes, the files in `.taskgraph/`, and,
optionally, what a command printed. It is the gate for moving the older
scripts into `@tm/core`: the same commands before and after a change should
leave the same files.

```bash
node apps/cli/tests/parity/compare-builds.mjs \
  --a "node $PWD/dist/taskgraph.js" \
  --b "npx -y -p taskgraph-ai@0.54.7 taskgraph" \
  [--scenario apps/cli/tests/parity/scenarios/basic.json]
```

A build is a shell command that runs the CLI. Paths in it must be absolute,
because it runs inside a temporary project. Exit code: 0 no differences, 1
differences, 2 bad usage or a build that cannot run.

## Comparing a change with the code before it

For a migration PR, compare the branch with `main`, not with a release, so the
only differences are the PR's own:

```bash
git worktree add ../taskgraph-base origin/main
(cd ../taskgraph-base && npm ci && npm run build)
node apps/cli/tests/parity/compare-builds.mjs \
  --a "node $PWD/../taskgraph-base/dist/taskgraph.js" \
  --b "node $PWD/dist/taskgraph.js"
```

Run every scenario below. Expect no differences.

## Scenarios

| File | What it covers |
|---|---|
| `basic.json` | 24 steps: reads, status changes, subtasks, dependencies, move, tags, and the AI commands against the fake `claude`. Output of `next`, `show` and `list` is compared (JSON). |
| `edge-bulk-update.json` | `update --from` when the model answers `null` for `details`, `testStrategy` and `subtasks` (#229). |
| `edge-cancelled-dependency.json` | `next` when a task depends on a cancelled task (#231). |
| `edge-stale-lock.json` | `set-status` when a crashed older save left a stale `tasks.json.lock` file (#234). |

A step is a list of CLI arguments, or an object: `{"args": [...], "capture":
"stdout"}` also compares what the command printed (use a JSON format), and
`{"shell": "..."}` runs a shell command in the project to prepare state.
Scenarios run in separate projects, one probe each, so a difference in one
cannot cloud another. Add a scenario for a new edge case rather than a step to
an existing one.

## Expected differences from `taskgraph-ai@0.54.7`

The last release on npm is 0.54.7. These differences are the audit fixes, not
regressions:

- `edge-bulk-update.json`: 0.54.7 writes `null` over `details`, `subtasks` and
  `testStrategy`; the current build keeps them.
- `edge-cancelled-dependency.json`: the current build offers the task that
  depends on a cancelled task; 0.54.7 finds no next task.
- `edge-stale-lock.json`: the current build takes over the stale lock; 0.54.7
  fails with `ENOTDIR`.

`basic.json` has no differences from 0.54.7.

## What is not compared

Human-formatted output (tables, colors), the order of unrelated output lines,
timing, and files outside `.taskgraph/{config.json,state.json,tasks,reports}`.
Timestamps and temporary paths are masked, `metadata.schemaVersion` is dropped,
and JSON keys are sorted before comparing. Each build runs with its own
`HOME`, and AI commands run against the fake `claude` in `../fakes`, so results
do not depend on this machine or on a real model.
