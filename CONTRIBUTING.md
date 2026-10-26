# Contributing to TaskGraph

Thank you for your interest in contributing to TaskGraph! We're excited to work with you and appreciate your help in making this project better. 🚀

## 🤝 Our Collaborative Approach

We're a **PR-friendly team** that values collaboration:

- ✅ **We review PRs quickly** - Usually within hours, not days
- ✅ **We're super reactive** - Expect fast feedback and engagement
- ✅ **We sometimes take over PRs** - If your contribution is valuable but needs cleanup, we might jump in to help finish it
- ✅ **We're open to all contributions** - From bug fixes to major features

**We don't mind AI-generated code**, but we do expect you to:

- ✅ **Review and understand** what the AI generated
- ✅ **Test the code thoroughly** before submitting
- ✅ **Ensure it's well-written** and follows our patterns
- ❌ **Don't submit "AI slop"** - untested, unreviewed AI output

> **Why this matters**: We spend significant time reviewing PRs. Help us help you by submitting quality contributions that save everyone time!

## 🚀 Quick Start for Contributors

### 1. Fork and Clone

```bash
git clone https://github.com/YOUR_USERNAME/taskgraph-ai.git
cd taskgraph-ai
npm install
```

### 2. Create a Feature Branch

Branch from `main`:

```bash
git checkout main
git pull origin main
git checkout -b feat/your-feature-name
```

### 3. Make Your Changes

Follow our development guidelines below.

### 4. Test Everything Yourself

**Before submitting your PR**, ensure:

```bash
# Run all tests
npm test

# Check formatting
npm run format-check

# Fix formatting if needed
npm run format
```

`npm install` also installs a pre-push hook (`.githooks/pre-push`) that runs the formatter check on the files your branch changed, so a formatting failure shows up before CI does.

### 5. Submit Your PR

- Target `main`
- Use a conventional-commit title (see Versioning below)
- Write a clear description
- Reference any related issues
- Don't rebase onto `main` after other PRs merge. `main` doesn't require branches to be up to date, and PRs are squash-merged once they are green

## 📋 Development Guidelines

### Branch Strategy

- **`main`**: The only long-lived branch. PRs target it, and releases are cut from it
- **Feature branches**: `feat/description`, `fix/description`, `docs/description`

### Roadmap: GitHub issues and TaskGraph

The roadmap is tracked in two places: [GitHub issues](https://github.com/stephennmiller/taskgraph-ai/issues) and this repo's own `.taskgraph/tasks/tasks.json`, so that `taskgraph next` here returns current work. **The GitHub issue wins.** Its scope, done criteria and open or closed state are the source of truth; the task points at it and sets the order.

- Each open issue has one task in the `master` tag, titled `<issue title> (#<n>)`, with the issue link in its details. Epics that only group other issues (#195, #242) have no task (or a cancelled one); epics with steps of their own (#254, #328) have a subtask per step.
- Task dependencies follow the "Order" sections of the epics.
- New issue: run `taskgraph github import`. It adds a task titled `<issue title> (#<n>)`, linked to the issue, for each open issue that has none, and links any unlinked task already titled that way. Running it again adds nothing. It also adds a task for an epic that only groups other issues: set that one to `cancelled` (don't remove it, or the next import adds it back).
- Closing an issue: `taskgraph github pull -y` marks its task `done` (`cancelled` if it closes as not planned). In the PR that closes it, you can still set the task to done by hand: `taskgraph set-status --id=<task id> --status=done`.
- When the task and the issue disagree, change the task to match the issue.

`taskgraph github push` leaves imported issues alone, so running it here doesn't rewrite or duplicate them. Tasks that aren't linked to an issue would still get a new one, so run `import` first.

### Code Quality Standards

1. **Write tests** for new functionality
2. **Follow existing patterns** in the codebase
3. **Add JSDoc comments** for functions
4. **Keep functions focused** and single-purpose

### Testing Requirements

Your PR **must pass all CI checks**:

- ✅ **Tests**: `npm test`, plus `npm run test -w @tm/cli` and `npm run test -w @tm/core` for the packages you touched
- ✅ **Types**: `npm run turbo:typecheck`
- ✅ **Scripts and evals types**: `npm run typecheck:root` (checks `scripts/dev.js` and `evals/`, which no workspace typecheck covers)
- ✅ **Format check**: `npm run format-check`
- ✅ **Unused code**: `npm run knip` (files, exports and dependencies nothing uses)

**Test your changes locally first** - this saves review time and shows you care about quality.

## 📦 Versioning

Releases are cut automatically when a PR merges to `main`, from its commit title. Don't add a changeset.

| Title prefix | Release |
| --- | --- |
| `feat:` | Minor (patch while TaskGraph is below 1.0) |
| `fix:`, `perf:`, `revert:` | Patch |
| `feat!:` or a `BREAKING CHANGE:` footer | Major (minor while below 1.0) |
| `chore:`, `docs:`, `ci:`, `test:` | No release |

The title becomes the release note, so write it for users: say what they get or what's fixed.

```bash
# Good
feat: research prints the answer once, rendered to fit the terminal
fix: models --setup no longer leaves the menu on screen after Ctrl-C

# Not as useful
feat: refactor research.js
```

### Releasing and rolling back (maintainers)

Merging cuts the tag and the GitHub Release, but it does not publish to npm. The release workflow **stages** the build under the `next` dist-tag. Nothing is installable until a maintainer approves it, and `latest` (what `npm install -g taskgraph-ai` and the CLI's update check use) moves only when you promote it.

1. **Approve** the staged build. It goes to `next`:

   ```bash
   npm stage list taskgraph-ai          # staged versions and their ids
   npm stage approve <stage-id>         # publish one (asks for 2FA)
   npm view taskgraph-ai dist-tags      # `next` is the new version, `latest` the old one
   ```

   Approve only the newest staged version. Each one is built from its own tag, so the newest already includes every earlier fix.

2. **Soak.** Install it with `npm install -g taskgraph-ai@next` and use it for a while.

3. **Promote.** Run the **Set npm latest** workflow with that version, then approve its `npm-release` deployment:

   ```bash
   gh workflow run npm-dist-tag.yml -f version=<version>
   ```

**Rollback**, when a bad version reached `latest`:

1. Run **Set npm latest** with the last good version (`gh workflow run npm-dist-tag.yml -f version=<good-version>`). New installs and the CLI's update check get it straight away. Anyone already on the bad version runs `npm install -g taskgraph-ai@latest`.
2. Revert the PR on `main` with a `revert:` title. That cuts a new patch release, staged under `next` like any other.
3. Deprecate the bad version from your machine (it asks for 2FA; trusted publishing can't run `npm deprecate`): `npm deprecate "taskgraph-ai@<bad-version>" "<what breaks>; use <good-version>"`. Don't unpublish.

A bad version that only reached `next` needs no rollback: don't promote it, and approve the fix when it's staged.

## 🔧 Development Setup

### Prerequisites

- Node.js 22.19+
- npm or yarn

### Environment Setup

1. **Copy environment template**:

   ```bash
   cp .env.example .env
   ```

2. **Sign in to Claude Code** (for testing AI features). No provider API keys are needed:
   ```bash
   claude
   ```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Run a package's tests
npm run test -w @tm/cli
npm run test -w @tm/core
```

### Plan Evals

`npm run evals` checks the plans the AI commands make. It runs parse-prd, analyze-complexity and expand on each sample PRD in `evals/samples/`, through the same Claude Code backend as the CLI, so it calls the real model and uses your Claude Code sign-in. It is never run in CI.

Each plan gets plain checks (every PRD heading has a task, apart from out of scope, non-goals and open questions and the headings inside them; dependencies point to existing earlier tasks with no cycles, subtask counts follow complexity scores, acceptance criteria are present, and task counts grow with PRD size) and, separately, a 1–5 grade on a fixed rubric from an LLM judge. The run is saved to `evals/results/<date and time>.json` with tokens and seconds per call, and compared with `evals/baseline.json`. A run with `--only` is compared with the same samples of the baseline.

```bash
npm run evals                          # every sample, then the change from the baseline
npm run evals -- --only cli-notes      # some samples, comma-separated
npm run evals -- --no-judge            # skip the judge
npm run evals -- --config path.json    # models from a TaskGraph config.json
npm run evals -- --update-baseline     # save this run as the baseline (every sample, with the judge)
```

Run it before and after changing a prompt or the default model, and update the baseline in the same PR when the change is an improvement. The scoring lives in `packages/tm-core/src/modules/evals/`.

### Review Evals

`npm run evals:review` checks the review bot. It runs the prompt and tools from `.github/workflows/claude-code-review.yml` with `claude -p` on each PR in `evals/review-cases.json`: merged PRs that shipped a bug later reverted or fixed forward, with the bug's file and lines, and a few PRs with no known bug. Each runs in a worktree at the PR's merge commit with today's `REVIEW.md`, `CLAUDE.md` and `.claude/rules/`. It runs with `--restricted --strict-mcp-config`, so your own settings, allow rules and MCP servers don't apply, the posting tools are denied, and an added system prompt keeps it from posting to GitHub and asks for its findings as `FINDING <path>:<line>` lines. A finding within 5 lines of a known bug catches it.

It reports recall (known bugs caught), findings on the clean PRs (noise), and other findings on the buggy PRs, saves the run to `evals/results/review-<date and time>.json` and prints `evals/review-baseline.json` next to it. It calls the real model with your Claude Code sign-in, needs `gh` signed in and the full git history (`git fetch --unshallow origin` in a shallow clone), and is never run in CI.

```bash
npm run evals:review                                    # every case
npm run evals:review -- --only 683-placeholder-tasks-json
npm run evals:review -- --update-baseline               # save this run as the baseline
```

Run it before and after changing the review workflow's prompt, tools or model. When a PR is reverted or fixed forward, add a case with the original PR's merge commit and the bug's lines in that commit.

### Code Formatting

We use [Biome](https://biomejs.dev) for consistent formatting:

```bash
# Check formatting
npm run format-check

# Fix formatting
npm run format
```

## 📝 PR Guidelines

### Before Submitting

- [ ] **Target `main`** with a conventional-commit title
- [ ] **Test everything locally**
- [ ] **Run the full test suite**
- [ ] **Check code formatting**
- [ ] **Re-read your changes** - ensure they're clean and well-thought-out

### PR Description Template

```markdown
## Description

Brief description of what this PR does.

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] I have tested this locally
- [ ] All existing tests pass
- [ ] I have added tests for new functionality

## Additional Notes

Any additional context or notes for reviewers.
```

### What We Look For

✅ **Good PRs**:

- Clear, focused changes
- Comprehensive testing
- Good commit messages
- Self-reviewed code

❌ **Avoid**:

- Massive PRs that change everything
- Untested code
- Formatting issues
- AI-generated code that wasn't reviewed

## 🏗️ Project Structure

```
taskgraph-ai/
├── bin/                    # CLI executables
├── apps/mcp/              # MCP server (@tm/mcp)
├── scripts/               # Core task management logic
├── src/                   # Shared utilities and providers and well refactored code (we are slowly moving everything here)
├── tests/                 # Test files
├── docs/                  # Contributor notes (user docs live in apps/docs/)
└── .claude/               # Claude Code rules (path-scoped dev conventions)
└── assets/                # Assets installed into user projects (e.g. AGENTS.md)
```

### Key Areas for Contribution

- **CLI Commands**: `apps/cli/src/commands/` (registered in `apps/cli/src/command-registry.ts`)
- **MCP Tools**: `apps/mcp/src/tools/`
- **Core Logic**: `packages/tm-core/src/`
- **AI Providers**: `packages/tm-core/src/modules/ai/providers/`
- **Tests**: `tests/`

## 🐛 Reporting Issues

### Bug Reports

Include:

- TaskGraph version
- Node.js version
- Operating system
- Steps to reproduce
- Expected vs actual behavior
- Error messages/logs

### Feature Requests

Include:

- Clear description of the feature
- Use case/motivation
- Proposed implementation (if you have ideas)
- Willingness to contribute

## 💬 Getting Help

- **Issues**: [GitHub Issues](https://github.com/stephennmiller/taskgraph-ai/issues)
- **Discussions**: [GitHub Discussions](https://github.com/stephennmiller/taskgraph-ai/discussions)

## 📄 License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT with Commons Clause).

---

**Thank you for contributing to TaskGraph!** 🎉

Your contributions help make AI-driven development more accessible and efficient for everyone.
