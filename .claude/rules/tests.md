---
description: How to write and place TaskGraph tests (Vitest), with examples from the package code
paths:
  - "**/*.spec.ts"
  - "**/*.test.ts"
  - "tests/**/*"
---

# Testing Guidelines

CLAUDE.md's "Test Guidelines" are the rules: where tests go, when to write them, what to mock. This file adds the patterns the packages already use. Copy the nearest existing test before writing a new one.

## Where tests go

| What | Where | Example |
| --- | --- | --- |
| Unit test, one module | next to the source, `<file>.spec.ts` | `apps/cli/src/commands/parse-prd.command.spec.ts` |
| tm-core integration | `packages/tm-core/tests/integration/<module>/<file>.test.ts` | `packages/tm-core/tests/integration/tasks/parse-prd.test.ts` |
| CLI through the built binary | `apps/cli/tests/integration/<area>/<file>.test.ts` | `apps/cli/tests/integration/commands/parse-prd-clarify.command.test.ts` |
| MCP tool | `apps/mcp/src/tools/<area>/<tool>.spec.ts`, `apps/mcp/tests/integration/tools/` | `apps/mcp/src/tools/tasks/parse-prd.tool.spec.ts` |
| Plugin hooks, git hooks, CI scripts | `tests/unit/` (root suite) | `tests/unit/githooks/check-file-size.test.ts` |

- New tests are TypeScript. The root `tests/` suite (`vitest.root.config.ts`, `.js` allowed) holds only repo-level checks; don't add feature tests there.
- Use `tests/unit/packages/<package>/` only when the test can't sit next to the source.
- Shared test data lives beside the tests that use it as a named-export module (for example `packages/tm-core/tests/integration/tasks/parse-prd-fixture.ts`), not in a global fixtures folder.

## Running tests

```bash
npm run test -w @tm/core -- parse-prd     # one package, files matching a pattern
npm run test -w @tm/cli -- -t "exits 1"   # tests whose name matches
npm run test:coverage -w @tm/core         # with coverage
npm test                                  # root tests/ suite
```

Tests that run `dist/taskgraph.js` (CLI and MCP integration) need `npm run build` first.

## Unit tests in the CLI and MCP

Mock tm-core; let Commander, chalk and the MCP framework run. Drive the real command class and assert on what it printed and handed tm-core:

```typescript
vi.mock('@tm/core', async (importOriginal) => ({
	...(await importOriginal<typeof import('@tm/core')>()),
	createTmCore: vi.fn()
}));

import { createTmCore } from '@tm/core';
import { ParsePrdCommand } from './parse-prd.command.js';

const parsePrd = vi.fn();
const parsePrdTarget = vi.fn();
let prd: string;

beforeEach(() => {
	prd = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-')), 'prd.md');
	fs.writeFileSync(prd, '# PRD');
	// Mock every tm-core call the command makes before the one under test,
	// or the test passes on an earlier error's exit 1
	vi.mocked(createTmCore).mockResolvedValue({
		tasks: { parsePrd, parsePrdTarget }
	} as any);
	parsePrdTarget.mockResolvedValue({ prdPath: prd, tag: 'master', taskCount: 0 });
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(process, 'exit').mockImplementation(((code: number) => {
		throw new Error(`exit ${code}`);
	}) as never);
});

it('says why it failed and exits 1', async () => {
	parsePrd.mockRejectedValue(new Error('Claude is overloaded'));

	await expect(
		new ParsePrdCommand().parseAsync([prd], { from: 'user' })
	).rejects.toThrow('exit 1');
	expect(parsePrd).toHaveBeenCalled();
});
```

- Don't rebuild a command's action as a "test version" or mock Commander's chain: that tests the copy, not the command.
- A hook tm-core calls (`onWarning`, `onPartial`) is tested by calling it from the mock: `parsePrd.mockImplementation(async (_input, hooks) => { hooks.onWarning('...'); ... })`.
- Strip ANSI codes before comparing printed text (`sgrFree` in `apps/cli/tests/helpers/hostile-text.ts`), and match the key part with `toContain`, not the whole styled line.
- Formatters in `apps/cli/src/ui/formatters/` are pure functions; test them with data in, string out, no console spies.

## tm-core tests

Mock only I/O at the edge. Use a real temp project and real services, and spy on the AI call:

```typescript
import { AiService } from '../../../src/modules/ai/ai-service.js';
import { createTmCore } from '../../../src/tm-core.js';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tm-')));
// write .taskgraph/config.json and .taskgraph/tasks/tasks.json here
const generateObject = vi
	.spyOn(AiService.prototype, 'generateObject')
	.mockResolvedValue({ mainResult: { tasks: [] }, telemetryData: null } as any);
const tmCore = await createTmCore({ projectPath: root });

afterEach(async () => {
	vi.restoreAllMocks();
	await tmCore.close();
	fs.rmSync(root, { recursive: true, force: true });
});
```

- Assert on the file on disk (re-read `tasks.json`), not on what a mock received, when the point is what got saved.
- Zod schemas get table tests for both the replies they take and the ones they reject (`packages/tm-core/src/modules/ai/schemas/parse-prd.spec.ts`).
- Never reach a real model or the Claude Code subprocess. The `claude-code` provider needs no API key, so a test must not set or depend on `ANTHROPIC_API_KEY`. CLI integration tests use the fake `claude` in `apps/cli/tests/fakes/install-fake-claude.mjs`.

## Async

Keep test bodies synchronous unless the code under test is async (CLAUDE.md "Synchronous Tests"). Import statically at the top; use `await import()` only after `vi.doMock()` when a test needs a different mock per test, with `vi.resetModules()` first.

## Vitest gotchas

- **Hoisting:** `vi.mock()` runs before the imports. A variable its factory uses must come from `vi.hoisted(() => ({ mockFn: vi.fn() }))`; a plain top-level `const` throws `ReferenceError`.
- **Missing exports throw:** an export the factory didn't return throws when used. Spread `await importOriginal()` (or `vi.importActual`) and override only what you mock.
- **Constructors:** an arrow-function mock can't be called with `new`. Use `vi.fn(function () { ... })` or a class.
- **Circular imports:** mocking a module in an import cycle can raise "Cannot access 'X' before initialization"; mock at the module boundary instead.
- **Console spies:** give them an implementation (`mockImplementation(() => {})`); `mockImplementation(console.log)` recurses.
- **Mock state:** call `vi.clearAllMocks()` in `beforeEach`, and `vi.restoreAllMocks()` when the test spied on a real object. Change `process.env` with `vi.stubEnv` so it is undone.
- **Slow tests that run the built CLI:** raise the file's timeout with `vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 })` (see `tests/integration/cli/complex-cross-tag-scenarios.test.js`).
- **Fake timers:** `vi.useFakeTimers()`, and `vi.useRealTimers()` in `afterEach`.

## Test quality

- Write the failing test first for a bug fix; it goes in the same commit as the fix.
- Test error paths and edge cases (missing IDs, empty files, hostile text from `apps/cli/tests/helpers/hostile-text.ts`), not only the happy path.
- Name tests for the behavior a user sees: `'exits 1 when no task ID exists'`, not `'calls handleError'`.
- Keep tests independent: each writes its own temp folder and never touches the repo's `.taskgraph/`.
- Match error text by its key phrase (`toThrow('not found')`) unless the exact wording is the point.
