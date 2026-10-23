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

## In CI

The `Parity` job in `.github/workflows/ci.yml` runs this comparison on a pull
request. It builds the target branch's commit, then runs every scenario below
with the target branch as build A and the pull request as build B.

- **When it runs:** only when the pull request changes `scripts/`,
  `mcp-server/`, `src/`, `packages/tm-core/src/`, `apps/cli/src/`,
  `apps/mcp/src/`, this folder, or `.github/scripts/run-parity.sh`. The
  `Parity changes` job decides this from the list of changed files and the
  `Parity` job is skipped otherwise. A change to the workflow file alone does
  not start it.
- **Where to read it:** the job summary has one row per scenario, and the first
  60 lines of each report that differs. The full reports are in the
  `parity-reports` artifact (kept for 7 days).
- **It does not fail the pull request on a difference.** A pull request that
  fixes a bug is meant to differ, and a difference is a prompt to read it, not
  a verdict. The job fails only when a scenario cannot run (exit 2): a broken
  scenario, or a build that cannot run `init`. It is not a required check.
- **To run the same thing locally:** build both trees, then
  `.github/scripts/run-parity.sh <base-root> <head-root> <reports-dir>`. Each
  root is a checkout with a built `dist/`; the scenarios and the tool come from
  the head root. A fourth argument names another folder of scenarios.

## Scenarios

| File | What it covers |
|---|---|
| `basic.json` | 24 steps: reads, status changes, subtasks, dependencies, move, tags, and the AI commands against the fake `claude`. Output of `next`, `show` and `list` is compared (JSON). |
| `edge-bulk-update.json` | `update --from` when the model answers `null` for `details`, `testStrategy` and `subtasks` (#229). |
| `edge-cancelled-dependency.json` | `next` when a task depends on a cancelled task (#231). |
| `edge-stale-lock.json` | `set-status` when a crashed older save left a stale `tasks.json.lock` file (#234). |
| `phase1-dependencies.json` | Add, remove, validate and fix dependencies (CLI and MCP), a subtask ID as a dependency, and the failures: self-dependency, cycle, unknown ID. A deliberately broken graph for validate and fix. |
| `phase1-removal.json` | `remove-task` (one and several IDs), `remove-subtask` (also `--convert`), `clear-subtasks` (one task, `--all`), and their failures (non-subtask, subtask ID, unknown task). |
| `phase1-structure.json` | `add-subtask` (new, and converting a task), `move` (task to subtask, subtask to task, several IDs, onto an existing ID, across tags with `--ignore-dependencies`, and the cross-tag conflict). |
| `phase1-move-dependencies.json` | `move` across tags with `--with-dependencies` (the moved task's dependencies must arrive in the target tag) and `--ignore-dependencies` (they stay behind), CLI and MCP. |
| `phase1-tag-flag.json` | Every non-tag command and tool with `--tag` / the MCP `tag` parameter on a tag that is not current, and an unknown tag. The current tag's tasks must stay untouched. |
| `phase1-tags.json` | `add-tag` (`--copy-from-current`, `--copy-from`, `--from-branch`, also the MCP `fromBranch`), the `tags` subcommands, renaming and deleting the current tag, the older `use-tag`/`rename-tag`/`copy-tag`/`delete-tag`, the six tag MCP tools, and the failures (existing tag, unknown tag, removing `master`). |
| `phase1-flat-format.json` | Reads and writes on an old file with no tags (`{"tasks": [...]}`): the first write moves it under `master`. |
| `phase1-no-master.json` | A file whose only tag is `sprint`: reads fall back to it, writes to the missing current tag `master` fail until `tags use sprint`. |

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
  says `"expectError": true`. A call that did not complete cleanly (the server
  crashed or timed out, or wrote a non-JSON-RPC line to stdout) is never an
  accepted error: the step fails and its stderr is printed. `mcp` cannot be
  combined with `args`, `shell`, `capture` or `expectExit`. A reply is compared
  as its text only when it has a single text part; anything else is compared
  whole.
- **Environment**: the same isolated `HOME` and fake `claude` as CLI steps.
  `TASKGRAPH_PROJECT_ROOT` is removed from the environment, because the
  server prefers it over a tool's `projectRoot`.
- **Masked in replies**: the top-level `version` field and the
  `Version:`/`Name:` footer of plain-text error replies. (Locale dates such as
  `10/22/2026`, written by tag copy, are masked in every file and reply.) Everything else, including `data.message` and tips
  text, is compared as is.

## Phase 1 coverage

Each command and MCP tool the move into `@tm/core` touches, with the scenario
that runs it on a success path. `fail` marks the scenario with a step that is
meant to exit 1 (CLI `expectExit`, MCP `expectError`). A test checks that this
table names all 15 tools and every command, and that each one runs on a success
path in some scenario, so a gap shows up there.

| CLI command | MCP tool | Success | Failure |
|---|---|---|---|
| `add-dependency` | `add_dependency` | `phase1-dependencies.json`, `phase1-tag-flag.json`, `phase1-flat-format.json`, `phase1-no-master.json` | `phase1-dependencies.json` (self, cycle, unknown ID), `phase1-no-master.json` |
| `remove-dependency` | `remove_dependency` | `phase1-dependencies.json`, `phase1-flat-format.json` | `phase1-dependencies.json` |
| `validate-dependencies` | `validate_dependencies` | `phase1-dependencies.json` | `phase1-dependencies.json` (broken graph exits 1) |
| `fix-dependencies` | `fix_dependencies` | `phase1-dependencies.json`, `phase1-tag-flag.json` | none: it repairs the graph and reports instead of failing |
| `clear-subtasks` | `clear_subtasks` | `phase1-removal.json`, `phase1-flat-format.json` | `phase1-removal.json` (subtask ID) |
| `remove-task` | `remove_task` | `phase1-removal.json`, `phase1-flat-format.json` | `phase1-removal.json` (unknown ID) |
| `remove-subtask` | `remove_subtask` | `phase1-removal.json` | `phase1-removal.json` (not a subtask) |
| `add-subtask` | `add_subtask` | `phase1-structure.json`, `phase1-removal.json` | `phase1-structure.json` (circular) |
| `move` | `move_task` | `phase1-structure.json`, `phase1-move-dependencies.json`, `phase1-tag-flag.json` | `phase1-structure.json` (existing ID, cross-tag conflict), `phase1-no-master.json` |
| `add-tag`, `tags add` | `add_tag` | `phase1-tags.json` | `phase1-tags.json` (existing tag) |
| `tags` / `tags list` | `list_tags` | `phase1-tags.json`, `phase1-flat-format.json` (CLI and MCP) | none |
| `tags use`, `use-tag` | `use_tag` | `phase1-tags.json`, `phase1-no-master.json` | `phase1-tags.json` (unknown tag) |
| `tags rename`, `rename-tag` | `rename_tag` | `phase1-tags.json` (also the current tag) | `phase1-tags.json` (unknown tag, CLI and MCP) |
| `tags copy`, `copy-tag` | `copy_tag` | `phase1-tags.json` | `phase1-tags.json` (unknown tag, CLI and MCP) |
| `tags remove`, `delete-tag` | `delete_tag` | `phase1-tags.json` (also the current tag) | `phase1-tags.json` (`master`) |

`--from-branch` (CLI) and `fromBranch` (MCP `add_tag`, which then ignores
`name`) name the tag after the current git branch. The tags scenario creates
the branches and a commit with `git -c user.name=x -c user.email=y commit`,
because the isolated `HOME` has no git identity. The harness removes `GIT_*`
variables from the environment, so these git steps never touch a real
repository, even when the run starts inside a hook of a linked worktree.

The `--tag` option and the MCP `tag` parameter (writing to a tag that is not
current is a separate code path) are exercised by `phase1-tag-flag.json` for
`add-dependency`, `remove-dependency`, `validate-dependencies`,
`fix-dependencies`, `clear-subtasks`, `remove-task`, `remove-subtask`,
`add-subtask` and `move`, with the matching tools.

## Known quirks the scenarios pin on purpose

These are behaviours of the current code that look wrong. The scenarios record
them as they are, so a difference in one of them means the behaviour changed.
Decide deliberately whether the change is intended (and update the expectation
and this list) instead of accepting the difference quickly. In particular, a
tidy-up that "fixes" a type can change what a dependency means.

- **On a subtask, the type of a dependency ID carries its meaning.** In a
  subtask's list a bare number up to 99 names a sibling subtask and a string
  names a task (`resolveSubtaskDependency` in
  `packages/tm-core/src/modules/dependencies/subtask-dependency.ts`, used by
  `scripts/modules/dependency-manager.js`). `add-dependency` and
  `add_dependency` write `"1"` (a string) on a subtask, and
  `remove-subtask --convert` makes the parent a string dependency of the new task
  (`["4"]`). So on subtask
  2.2 a stored `1` means subtask 2.1, while `"1"` means task 1, and
  `phase1-flat-format.json` and `phase1-no-master.json` leave 2.2 with
  `[1, "1"]`: two different dependencies, not a repeat.
  A migration that normalizes `"1"` to `1` would silently turn a dependency
  on task 1 into one on sibling 2.1. On a top-level task, `add-dependency`
  and `add-task` write strings and `add-dependency` rewrites the list it adds
  to into that form (`[2, "1"]` became `["1", "2"]` in #290), through
  `toTaskDependency` in the same file.
- **Removing a dependency that is not there succeeds.** `remove-dependency`
  exits 0 and `remove_dependency` succeeds with `removed: false` and "Task 2
  doesn't depend on task 5; nothing changed" for a task that never depended on
  the other (`phase1-dependencies.json`). An unknown task ID does fail.
- **`validate_dependencies` does not report a duplicate** such as `[2, 3, 3]`,
  while `fix_dependencies` removes it and lists it as `duplicate`.
- **`move` keeps the old `parentTaskId`** on the subtasks of a moved task
  (task 4 moved to 9: its subtasks still say `parentTaskId: 4`).
- **`list --format json` on the no-master file** reports `"tag": "master"` in
  its metadata while it shows the tasks of `sprint`.

## Expected differences from published releases

Against `taskgraph-ai@0.54.14` (the latest release when the Phase 1 scenarios
were added), `basic.json` and the `edge-*` scenarios show none: it already has
the audit fixes below. The Phase 1 scenarios differ only because of fixes it
does not have:

- `add_dependency`, `remove_dependency`, `validate_dependencies`,
  `fix_dependencies`, `clear_subtasks` and `models` fail on every call in
  0.54.14 and earlier with `Operation failed: e is not a function` (#268, fixed
  in #270). Every MCP step that calls one of them differs, and so does every
  later `tasks.json` that the failed call would have changed. Seen in
  `phase1-dependencies.json`, `phase1-removal.json`,
  `phase1-flat-format.json` and `phase1-no-master.json`. The report also lists
  those steps as ones that "did not exit as expected" for the release.
  `phase1-structure.json` and `phase1-tags.json` have no differences. A
  release newer than #270 shows only the next difference.
- `remove_dependency` replied "Successfully removed dependency" for a
  dependency the task never had, and `remove_dependency`, `add_subtask` and
  `remove_subtask` called with `tag: "other"` replied `"tag": "master"` (#291,
  #292). Against a release without those fixes, those MCP replies differ in
  `phase1-dependencies.json` and `phase1-tag-flag.json`.

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
