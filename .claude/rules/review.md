---
description: How to report code review findings on TaskGraph PRs, and the TypeScript/Node bugs to look for
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "scripts/**/*.js"
---

# Reviewing a PR

Adapted from the ECC code-reviewer and typescript-reviewer agents (affaan-m/ecc v2.2.3). Check `robustness.md` first; this file covers how to report findings and the general TypeScript bugs.

## Before you report a finding

Drop the finding, or lower its severity, unless you can answer yes to all four:

1. Can you cite the file and line?
2. Can you name the input, the state and the bad outcome?
3. Have you read the callers, imports and tests? Many issues are already handled one frame up or ruled out by a type.
4. Is the severity defensible? A missing comment is never HIGH.

A HIGH or CRITICAL finding includes the snippet, the failure scenario, and why existing guards (types, validation, tests) don't catch it. A review with zero findings is a valid review; don't invent nits to fill it.

| Severity | Meaning | Merge |
|---|---|---|
| CRITICAL | Security hole or data loss | Blocks |
| HIGH | A bug a user can hit | Fix before merge |
| MEDIUM | Maintainability | Fix if cheap, else file an issue |
| LOW | Style | Mention once or skip |

## Common false positives

Skip these unless you can show a real trigger in this code:

- "Add error handling" when the caller or the command's top-level handler already catches it.
- "Validate input" on an internal function whose callers validate. Trace one caller first.
- "Possible null" when a guard or type narrowing is in scope.
- "Missing await" on a call marked `void` or commented as fire-and-forget.
- "Function too long" for exhaustive switches, test tables or config objects.
- "Hardcoded value" in tests and fixtures.

## TypeScript and Node bugs worth flagging

- `array.forEach(async ...)` (nothing awaits it) and floating promises.
- `JSON.parse` on file or AI output without a try/catch and a clear error.
- `as` casts or `!` that silence a real type error; new `any` without a reason.
- Untrusted input reaching `child_process`, `fs` paths without `path.resolve` plus a prefix check, or object merges without `Object.create(null)`.
- `throw` of a non-`Error`; a `catch` that drops the error or turns it into `null`/`[]` with no message.
