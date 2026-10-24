# Expected differences from published releases

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
