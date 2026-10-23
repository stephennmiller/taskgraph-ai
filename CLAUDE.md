# Claude Code Instructions

## TaskGraph Instructions

**Import TaskGraph's development workflow commands and guidelines, treat as if import is in the main CLAUDE.md file.**
@./.taskgraph/CLAUDE.md

## Commands

```bash
npm run build                     # tsdown production build
npm run turbo:typecheck           # run before pushing
npm run format-check              # Biome; `npm run format` to fix
npm run test -w @tm/core          # one package (also @tm/cli, @tm/mcp); coverage off
npm run test:coverage -w @tm/core # with coverage and thresholds (not met yet); Vitest
npm test                          # root tests/ suite (Vitest, vitest.root.config.ts)
```

`npm install` points git at `.githooks/`. The pre-push hook runs `biome format` on files changed since `origin/main`. Fix with `npm run format`; `git push --no-verify` skips it once.

## Test Guidelines

### Test File Placement

- **Package & tests**: Place in `packages/<package-name>/src/<module>/<file>.spec.ts` or `apps/<app-name>/src/<module>/<file.spec.ts>` alongside source
- **Package integration tests**: Place in `packages/<package-name>/tests/integration/<module>/<file>.test.ts` or `apps/<app-name>/tests/integration/<module>/<file>.test.ts` alongside source
- **Isolated unit tests**: Use `tests/unit/packages/<package-name>/` only when parallel placement isn't possible
- **Test extension**: Always use `.ts` for TypeScript tests, never `.js`. Exception: the legacy root `tests/` suite is Vitest with `.js` tests; new tests go in packages/apps, not there.

### Synchronous Tests

- **NEVER use async/await in test functions** unless testing actual asynchronous operations
- Use synchronous top-level imports instead of dynamic `await import()`
- Test bodies should be synchronous whenever possible
- Example:

  ```typescript
  // ✅ CORRECT - Synchronous imports with .ts extension
  import { MyClass } from '../src/my-class.js';

  it('should verify behavior', () => {
    expect(new MyClass().property).toBe(value);
  });

  // ❌ INCORRECT - Async imports
  it('should verify behavior', async () => {
    const { MyClass } = await import('../src/my-class.js');
    expect(new MyClass().property).toBe(value);
  });
  ```

### When to Write Tests

**ALWAYS write tests for:**

- **Bug fixes**: Add a regression test that would have caught the bug
- **Business logic**: Complex calculations, validations, transformations
- **Edge cases**: Boundary conditions, error handling, null/undefined cases
- **Public APIs**: Methods other code depends on
- **Integration points**: Database, file system, external APIs

**SKIP tests for:**

- Simple getters/setters: `getX() { return this.x; }`
- Trivial pass-through functions with no logic
- Pure configuration objects
- Code that just delegates to another tested function

**Bug Fix Workflow:**

1. Encounter a bug
2. Write a failing test that reproduces it
3. Fix the bug
4. Verify test now passes
5. Commit both fix and test together

### Testing Guidelines

Structure tests as Arrange, Act, Assert.

#### What to Mock

**Unit tests** (`.spec.ts` - test single unit in isolation):

- **@tm/core**: Mock only external I/O (APIs, filesystem). Use real internal services.
- **apps/cli**: Mock tm-core responses. Use real Commander/chalk/inquirer/other npm packages (test display logic).
- **apps/mcp**: Mock tm-core responses. Use real MCP framework (test response formatting).

**Integration tests** (`tests/integration/` - test multiple units together):

- **All packages**: Use real tm-core, mock only external boundaries (APIs, DB, filesystem).

**Never mock**:

- Internal utilities/helpers in the same package
- Standard frameworks (Commander, Express) - let them run
- Standard library

**Rule of thumb**: Mock what you're NOT testing. CLI unit tests test display → mock tm-core. Core unit tests test logic → mock I/O. Integration tests test full flow → mock only external APIs.

**Red flag**: Mocking 3+ dependencies in a unit test means code is doing too much or is in the wrong layer.

**Anti-pattern**: Heavily mocked tests don't verify real behavior—they verify that you wired up mocks correctly. You end up writing orchestration code to satisfy tests, rather than tests that validate your actual implementation. If testing is hard, move the logic to where it's naturally testable.

## Architecture Guidelines

### Workspaces

- `packages/tm-core` (`@tm/core`): all business logic
- `apps/cli` (`@tm/cli`), `apps/mcp` (`@tm/mcp`): thin presentation layers over tm-core
- `packages/tm-profiles` (`@tm/profiles`): shell utils and `pruneLegacySlashCommands`, which removes the files older `init` runs wrote to `.claude/commands/tm`. Slash commands live only in the plugin
- `packages/claude-code-plugin` (`@tm/claude-code-plugin`): the Claude Code plugin, markdown and JSON only (`commands/`, `agents/`, `hooks/hooks.json`, `.claude-plugin/plugin.json`), no TypeScript. Hook commands are shell one-liners in `hooks.json`, tested in `tests/unit/packages/claude-code-plugin/`
- `packages/build-config` (`@tm/build-config`): shared tsdown base config, compiled with `tsc` and imported by the root `tsdown.config.ts`; `npm run build` builds it first
- `apps/docs`: Mintlify docs source (not a code package)
- `apps/extension`, `packages/tm-bridge`, `packages/ai-sdk-provider-grok-cli` hold only untracked build artifacts and have no `package.json`. Don't add code there.

### Business Logic Separation

**CRITICAL RULE**: ALL business logic must live in `@tm/core`, NOT in presentation layers.

- **`@tm/core`** (packages/tm-core/):
  - Contains ALL business logic, domain models, services, and utilities
  - Provides clean facade APIs through domain objects (tasks, auth, workflow, git, config)
  - Houses all complexity - parsing, validation, transformations, calculations, etc.
  - Example: Task ID parsing, subtask extraction, status validation, dependency resolution

- **`@tm/cli`** (apps/cli/):
  - Thin presentation layer ONLY
  - Calls tm-core methods and displays results
  - Handles CLI-specific concerns: argument parsing, output formatting, user prompts
  - NO business logic, NO data transformations, NO calculations

- **`@tm/mcp`** (apps/mcp/):
  - Thin presentation layer ONLY
  - Calls tm-core methods and returns MCP-formatted responses
  - Handles MCP-specific concerns: tool schemas, parameter validation, response formatting
  - NO business logic, NO data transformations, NO calculations

**Examples of violations to avoid:**

- ❌ Creating helper functions in CLI/MCP to parse task IDs → Move to tm-core
- ❌ Data transformation logic in CLI/MCP → Move to tm-core
- ❌ Validation logic in CLI/MCP → Move to tm-core
- ❌ Duplicating logic across CLI and MCP → Implement once in tm-core

**Correct approach:**

- ✅ Add method to TasksDomain: `tasks.get(taskId)` (automatically handles task and subtask IDs)
- ✅ CLI calls: `await tmCore.tasks.get(taskId)` (supports "1" and "1.2")
- ✅ MCP calls: `await tmCore.tasks.get(taskId)` (same intelligent ID parsing)
- ✅ Single source of truth in tm-core

## Code Quality

Extract a pattern into a shared utility once it appears twice, not before. Export new modules from the package's index file.

## Documentation Guidelines

- **Documentation location**: Write docs in `apps/docs/` (Mintlify site source), not `docs/`
- **Documentation links**: Link to files in this repo (`docs/`, `apps/docs/`), not external sites

## Versioning & Release Guidelines

- **Use a conventional-commit PR title** - releases are cut automatically on merge to `main` from commit messages: `feat:` bumps minor, `fix:`/`perf:`/`revert:` bump patch, `!` or a `BREAKING CHANGE:` footer bumps major. Below 1.0.0 (the current 0.x line) every level shifts down one: `feat:` bumps patch and a breaking change bumps minor. `chore:`, `docs:`, `ci:`, `test:` do not release. Do not add a changeset: `.changeset/` is only read by the release workflow (`.github/workflows/release.yml`), and `version-bump.yml` bumps from commits.
- Keep the PR title user-facing: it becomes the release note, so say what the end-user gets or what is fixed
