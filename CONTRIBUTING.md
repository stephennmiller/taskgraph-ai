# Contributing to TaskGraph

Thanks for helping. This guide covers setup, the checks CI runs, how PRs get
reviewed and merged, and how releases ship. Coding conventions live in
[CLAUDE.md](CLAUDE.md) and [.claude/rules/](.claude/rules/); review criteria
live in [REVIEW.md](REVIEW.md).

AI-written code is welcome, as long as you have read it, tested it and can
explain it.

## Setup

You need Node.js 22.19 or later and, to try the AI commands, Claude Code
signed in (run `claude`). TaskGraph needs no AI provider API keys.

```bash
git clone https://github.com/<your-username>/taskgraph-ai.git
cd taskgraph-ai
npm install
npm run build
```

`npm install` points git at `.githooks/`. Its pre-push hook runs Biome on the
files your branch changed since `origin/main`. Fix a failure with
`npm run format`; `git push --no-verify` skips the hook once.

## Making a change

Branch from `main` (for example `fix/short-name`), and put the change where it
belongs:

- **Business logic**: `packages/tm-core` (`@tm/core`). All logic goes here.
- **CLI commands**: `apps/cli/src/commands/`, registered in
  `apps/cli/src/command-registry.ts`. Call `@tm/core` and format the result.
- **MCP tools**: `apps/mcp/src/tools/`, also a thin layer over `@tm/core`.
- **Claude Code plugin**: `packages/claude-code-plugin/` (markdown, JSON and
  shell only).
- **User docs**: `apps/docs/` (Mintlify).
- **Repo-level tests**: `tests/` (git hooks, CI scripts, plugin hooks).

Feature tests sit next to the code as `<file>.spec.ts`. A bug fix comes with a
regression test.

## Checks

CI runs these on every PR. Run the ones your change touches before you push.

- `npm run format-check`: Biome formatting (`npm run format` fixes it).
- `npm run turbo:typecheck`: types in every workspace.
- `npm run typecheck:root`: types in `scripts/dev.js` and `evals/`.
- `npm run knip`: unused files, exports and dependencies. Delete what your
  change left unused rather than adding it to `knip.jsonc`.
- `npm run build`: the tsdown production build.
- `npm test`: the root `tests/` suite.
- `npm run test -w @tm/cli`: one workspace (also `@tm/mcp`, `@tm/profiles`).
- `npm run test:coverage -w @tm/core`: `@tm/core` with its 80% coverage
  thresholds.

CI also runs smoke tests across operating systems and Node versions, installs
the packed tarball, checks CLI startup time, and compares the build with `main`
when bundled code changes.

## Pull requests

- Target `main` and fill in the
  [PR template](.github/PULL_REQUEST_TEMPLATE.md): what changed, what you ran,
  the risk and how to revert.
- Use a conventional-commit title written for users. It becomes the release
  note (see [Versioning](#versioning)). Don't add a changeset.
- The Claude review bot reviews each push to a non-draft PR opened by a
  collaborator from a branch in this repo, following [REVIEW.md](REVIEW.md).
  Fork PRs get a human review instead. The bot reviews only the commits since
  its last round and stops after three rounds. Fix each finding or reply
  saying why not.
- A PR merges when CI is green, every review thread is resolved, and it has no
  merge conflict. PRs are squash-merged with the PR title as the commit
  message. There is no merge queue, because the repo is owned by a personal
  account.
- `main` doesn't require branches to be up to date. Bring in `main` only when
  GitHub reports a conflict.

### Merging and risk tiers

A PR's risk tier comes from the paths it touches.
[`.github/CODEOWNERS`](.github/CODEOWNERS) lists the high-risk paths.

- **High risk**: any path in `.github/CODEOWNERS`. That covers CI and release
  workflows (`.github/workflows/`), `.github/scripts/`, the installer and
  upgrade path, the git hooks, the Claude Code AI backend and its sandboxing,
  and any `package.json` or the lockfile. These need the maintainer's
  approval. Agents open the PR, get it green, and leave it for the maintainer;
  they never merge it.
- **Low risk**: everything else (docs, tests, source outside those paths).
  Merges once review is done and CI is green.

A bot's approval never counts as the maintainer's. A push after an approval
needs a new approval.

## Versioning

Releases are cut automatically when a PR merges to `main`, from its squashed
commit title.

| Title prefix | Release |
| --- | --- |
| `feat:` | Minor (patch while TaskGraph is below 1.0) |
| `fix:`, `perf:`, `revert:` | Patch |
| `feat!:` or a `BREAKING CHANGE:` footer | Major (minor while below 1.0) |
| `chore:`, `docs:`, `ci:`, `test:` | No release |

Say what users get or what is fixed:

```text
Good:  fix: models --setup no longer leaves the menu on screen after Ctrl-C
Weak:  feat: refactor research.js
```

### Releasing and rolling back (maintainers)

Merging cuts the tag and the GitHub Release, but it does not publish to npm.
`version-bump.yml` **stages** the build under the `next` dist-tag. Nothing is
installable until a maintainer approves it, and `latest` (what
`npm install -g taskgraph-ai` and the CLI's update check use) moves only when
it is promoted.

1. **Approve** the staged build. It goes to `next`:

   ```bash
   npm stage list taskgraph-ai        # staged versions and their ids
   npm stage approve <stage-id>       # publish one (asks for 2FA)
   npm view taskgraph-ai dist-tags    # next is the new version
   ```

   Approve only the newest staged version. Each is built from its own tag, so
   the newest includes every earlier fix.

2. **Soak.** Install it with `npm install -g taskgraph-ai@next` and use it for
   a while.

3. **Promote.** Run the **Set npm latest** workflow with that version, then
   approve its `npm-release` deployment:

   ```bash
   gh workflow run npm-dist-tag.yml -f version=<version>
   ```

**Rollback**, when a bad version reached `latest`:

1. Run **Set npm latest** with the last good version. New installs and the
   update check get it at once; anyone on the bad version runs
   `npm install -g taskgraph-ai@latest`.
2. Revert the PR on `main` with a `revert:` title. That stages a new patch
   release under `next` like any other.
3. Deprecate the bad version from your machine, since trusted publishing can't
   run it: `npm deprecate "taskgraph-ai@<bad>" "<what breaks>; use <good>"`.
   Don't unpublish.

A bad version that only reached `next` needs no rollback: don't promote it,
and approve the fix when it's staged.

## Roadmap: GitHub issues and TaskGraph

The roadmap lives in
[GitHub issues](https://github.com/stephennmiller/taskgraph-ai/issues) and in
this repo's `.taskgraph/tasks/tasks.json`, so `taskgraph next` here returns
current work. **The GitHub issue wins**: its scope, done criteria and state are
the source of truth, and the task sets the order.

- Each open issue has one task in the `master` tag, titled
  `<issue title> (#<n>)`, linked to the issue. Epics that only group other
  issues have no task (or a cancelled one); epics with steps of their own have
  a subtask per step. Dependencies follow the epics' "Order" sections.
- New issue: run `taskgraph github import`. It adds a linked task for each
  open issue without one and is safe to rerun. Set a task it adds for a
  grouping epic to `cancelled`; don't remove it, or the next import adds it
  back.
- Closing an issue: in the PR that closes it, run
  `taskgraph set-status --id=<task id> --status=done`, or let
  `taskgraph github pull -y` mark it later (`cancelled` if the issue closed as
  not planned).
- When a task and its issue disagree, change the task.

Run `taskgraph github import` before `taskgraph github push`: push leaves
imported issues alone but opens a new issue for every unlinked task.

## Evals

Both evals call the real model with your Claude Code sign-in and never run in
CI.

**Plan evals** (`npm run evals`) run parse-prd, analyze-complexity and expand
on each PRD in `evals/samples/`. Each plan gets rule checks (coverage of PRD
headings, valid dependencies, subtask counts that follow complexity,
acceptance criteria) and a 1 to 5 grade from an LLM judge, compared with
`evals/baseline.json`. Run it before and after changing one of those prompts
or the default model, and update the baseline in the same PR when the plans
got better. The scoring lives in `packages/tm-core/src/modules/evals/`.

```bash
npm run evals                          # every sample
npm run evals -- --only cli-notes      # some samples, comma-separated
npm run evals -- --no-judge            # skip the judge
npm run evals -- --update-baseline     # save this run as the baseline
```

**Review evals** (`npm run evals:review`) run the review bot's prompt and
tools from `.github/workflows/claude-code-review.yml` on each PR in
`evals/review-cases.json`: merged PRs whose bug was later reverted or fixed
forward, plus a few clean ones. They report recall and noise, compared with
`evals/review-baseline.json` once `-- --update-baseline` has saved one, and
need `gh` signed in and the full git history. Run them before and after
changing the review workflow's prompt, tools or model. When a PR is reverted
or fixed forward, add a case for it.

## Reporting issues

Open an
[issue](https://github.com/stephennmiller/taskgraph-ai/issues/new/choose) from
one of the templates. For a bug, include the TaskGraph and Node.js versions,
your OS, the steps to reproduce, and what you expected. Report security
problems privately, as [SECURITY.md](SECURITY.md) describes.

## License

By contributing, you agree that your contributions are licensed under the
project's license (MIT with Commons Clause).
