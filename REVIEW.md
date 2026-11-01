# Review instructions

The Claude review bot (`.github/workflows/claude-code-review.yml`) reads this
file before every review. People reviewing a PR can use it too. Conventions
live in `CLAUDE.md` and `.claude/rules/*.md`; check `robustness.md` and
`review.md` there first.

## The bar

Report a finding only if it would break in real use, lose or corrupt data, or
open a security hole, or if it is code the change left unused (see "Dead
code"). Everything else stays out, however reasonable it sounds. Finding
nothing is a fine result: say `No issues` and stop. Don't fill a review with
suggestions to make it look thorough.

## What counts as a failure here

- Docs and agent instructions say something the code does not do. This covers
  `apps/docs/`, `README.md`, `CLAUDE.md`, `.taskgraph/CLAUDE.md`,
  `.claude/rules/`, and the plugin's commands and agents in
  `packages/claude-code-plugin/`.
- An AI call reaches outside the project or runs the project's hooks. Calls go
  through `packages/tm-core/src/modules/ai/providers/claude-code.ts` with
  `settingSources: []` and the path guard in `claude-code-path-guard.ts`.
- Business logic in `apps/cli` or `apps/mcp` instead of `@tm/core`.
- CLI output that breaks `.claude/rules/ui.md`.
- Any bug in the robustness checklist (`.claude/rules/robustness.md`).
- A bug fix without a regression test.
- Dead code: an export, helper, test, doc or file the change left unused.

## What to leave out

- Style and formatting. Biome and knip run in CI.
- Naming, readability, refactors, "consider" ideas and missing comments.
- Generated files: `package-lock.json`, `dist/`, `build/`, `coverage/`, and
  release commits from `chore(release)`.
- A change to `.taskgraph/tasks/tasks.json` that only sets a task's status.
- Anything you cannot tie to a concrete input and bad outcome.

## How to report

- Open the summary comment with `N issues` or `No issues`.
- Cite the file and line for every finding.
- Name the bug class (for example "unescaped AI text in output"), so the
  author fixes every instance and not just the line you cite.
- Mark a problem the PR did not introduce as `pre-existing`. It does not block
  the PR; suggest an issue for it.
- Do not raise a finding again once an earlier review reported it or the author
  answered it.

## Repeat findings

Findings the bot keeps raising belong in a rule, a lint check, `CLAUDE.md` or
a skill, so they stop at the source. Add one here when you see it twice, with
where it should be fixed.

- None yet.
