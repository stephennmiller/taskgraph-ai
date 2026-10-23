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

## 📋 Development Guidelines

### Branch Strategy

- **`main`**: The only long-lived branch. PRs target it, and releases are cut from it
- **Feature branches**: `feat/description`, `fix/description`, `docs/description`

### Roadmap: GitHub issues and TaskGraph

The roadmap is tracked in two places: [GitHub issues](https://github.com/stephennmiller/taskgraph-ai/issues) and this repo's own `.taskgraph/tasks/tasks.json`, so that `taskgraph next` here returns current work. **The GitHub issue wins.** Its scope, done criteria and open or closed state are the source of truth; the task points at it and sets the order.

- Each open issue has one task in the `master` tag, titled `<issue title> (#<n>)`, with the issue link in its details. Epics that only group other issues (#195, #242) have no task; epics with steps of their own (#254, #328) have a subtask per step.
- Task dependencies follow the "Order" sections of the epics.
- New issue: add its task, without AI: `taskgraph add-task --title='<issue title> (#<n>)' --description='<one line>' --details='GitHub issue #<n>: <url>'`.
- Closing an issue: in the PR that closes it, run `taskgraph set-status --id=<task id> --status=done` (`--status=cancelled` if it closes as not planned).
- When the task and the issue disagree, change the task to match the issue.

Don't run `taskgraph github push` here: these tasks aren't linked to their issues, so it would open a second issue for each one.

### Code Quality Standards

1. **Write tests** for new functionality
2. **Follow existing patterns** in the codebase
3. **Add JSDoc comments** for functions
4. **Keep functions focused** and single-purpose

### Testing Requirements

Your PR **must pass all CI checks**:

- ✅ **Tests**: `npm test`, plus `npm run test -w @tm/cli` and `npm run test -w @tm/core` for the packages you touched
- ✅ **Types**: `npm run turbo:typecheck`
- ✅ **Legacy JS types**: `npm run typecheck:root` (checks the JSDoc in `scripts/` against the TypeScript that calls it)
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

## 🔧 Development Setup

### Prerequisites

- Node.js 22.13+
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
├── mcp-server/            # MCP server implementation
├── scripts/               # Core task management logic
├── src/                   # Shared utilities and providers and well refactored code (we are slowly moving everything here)
├── tests/                 # Test files
├── docs/                  # Contributor notes (user docs live in apps/docs/)
└── .claude/               # Claude Code rules (path-scoped dev conventions)
└── assets/                # Assets installed into user projects (e.g. AGENTS.md)
```

### Key Areas for Contribution

- **CLI Commands**: `scripts/modules/commands.js`
- **MCP Tools**: `mcp-server/src/tools/`
- **Core Logic**: `scripts/modules/task-manager/`
- **AI Providers**: `src/ai-providers/`
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
