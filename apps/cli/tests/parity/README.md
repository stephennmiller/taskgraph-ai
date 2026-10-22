# Build comparison

`compare-builds.mjs` runs one scenario of CLI commands against two builds and
reports where they differ: exit codes, the files in `.taskgraph/`, and,
optionally, what a command printed. It is the gate for moving the older
scripts into `@tm/core`: the same commands before and after a change should
leave the same files.

```bash
node apps/cli/tests/parity/compare-builds.mjs \
  --a "node $PWD/dist/taskgraph.js" \
  --b "npx -y -p taskgraph-ai@0.54.12 taskgraph" \
  [--scenario apps/cli/tests/parity/scenarios/basic.json]
```

A build is a shell command that runs the CLI. Paths in it must be absolute,
because it runs inside a temporary project. `--timeout <ms>` sets the limit for
each command (60 seconds; the first `init` gets 5 minutes, because `npx` may
download the package).

Exit code: 0 no differences and every step exited as expected; 1 differences,
or a step that did not exit as expected; 2 bad usage, a malformed scenario, or
a build that cannot run.

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
`{"shell": "..."}` runs a shell command in the project to prepare state. Every
step is expected to exit 0; add `"expectExit": N` to a step that is meant to
fail. A step that exits otherwise fails the run even when both builds agree,
so a typo in a scenario cannot pass as "no differences". The tool checks the
scenario's shape first and names the step that is wrong.
Scenarios run in separate projects, one probe each, so a difference in one
cannot cloud another. Add a scenario for a new edge case rather than a step to
an existing one.

## MCP steps

`{"mcp": "get_tasks", "input": {"projectRoot": "<project>"}, "expectError":
false}` calls an MCP tool on each build's server and compares the reply, so
the CLI and the MCP layer of the same build can be checked in one scenario.
`<project>` in `input` becomes the temp project's path (tools need an absolute
`projectRoot`). The reply goes into the step's files as `mcp:N` (parsed and
key-sorted when it is JSON), so a differing field is reported with the step
number like any file. `mcp:tools` (tool names and input schemas) is compared
once per scenario, because a renamed parameter breaks clients.

- **Server per build**: derived from the build string. `.../dist/taskgraph.js`
  becomes `.../dist/mcp-server.js`; a build ending in the bin name `taskgraph`
  (the npx form) becomes `taskgraph-mcp`. If a scenario has an mcp step and
  the server cannot be derived, the tool exits 2 and says so.
- **One server start per call**, through `apps/mcp/tests/smoke/mcp-stdio.smoke.mjs`
  (all tools, `--timeout` applies). A 25-call scenario takes about a minute per
  build.
- **Errors**: an `isError` reply (or a JSON-RPC error with no content) is a
  result to compare. It counts as "did not exit as expected" unless the step
  says `"expectError": true`. `mcp` cannot be combined with `args`, `shell`,
  `capture` or `expectExit`.
- **Environment**: the same isolated `HOME` and fake `claude` as CLI steps.
  `TASKGRAPH_PROJECT_ROOT` is removed from the environment, because the
  server prefers it over a tool's `projectRoot`.
- **Masked in replies**: the `version` field, locale dates such as
  `10/22/2026` (written by tag copy), and the `Version:`/`Name:` footer of
  plain-text error replies. Everything else, including `data.message` and tips
  text, is compared as is.

## Expected differences from published releases

Against the latest release (`taskgraph-ai@0.54.12` or newer), expect none: it
already has the audit fixes below.

Against `taskgraph-ai@0.54.7`, the last release before them, these differences
are the audit fixes, not regressions:

- `edge-bulk-update.json`: 0.54.7 writes `null` over `details`, `subtasks` and
  `testStrategy`; the current build keeps them (#229).
- `edge-cancelled-dependency.json`: the current build offers the task that
  depends on a cancelled task; 0.54.7 finds no next task (#231).
- `edge-stale-lock.json`: the current build takes over the stale lock; 0.54.7
  fails with `ENOTDIR` (#234). The report also lists that step as one that "did
  not exit as expected" for 0.54.7, so this scenario exits 1 against it.

`basic.json` has no differences from either release.

## What is not compared

Human-formatted output (tables, colors), the order of unrelated output lines,
timing, and files outside `.taskgraph/{config.json,state.json,tasks,reports}`.
Timestamps and temporary paths are masked, `metadata.schemaVersion` is dropped,
and JSON keys are sorted before comparing. That has a cost: two builds that
both write a timestamp look the same even if one stops updating it, and a
difference in key order is invisible. A missing key still shows. Each build runs with its own
`HOME`, and AI commands run against the fake `claude` in `../fakes`, so results
do not depend on this machine or on a real model.
