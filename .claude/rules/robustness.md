---
description: Bugs that code review keeps finding in TaskGraph PRs, and the house fix for each
paths:
  - "packages/**/*.ts"
  - "apps/**/*.ts"
  - "scripts/**/*.js"
  - "src/**/*.js"
  - "mcp-server/**/*.js"
  - "packages/claude-code-plugin/**"
---

# Robustness checklist

Reviews of the October 2026 issue batches kept catching the same six bugs. Check for these before you push.

- **Escape codes in output.** Task titles, IDs, tags, notes, PRD paths and anything an AI wrote can hold terminal control sequences. Pass every such value through `terminalSafe` (`apps/cli/src/ui/formatters/markdown-formatters.ts`) before it's printed, including in dependency lists, headers and error messages (#284, #287, #354, #436).
- **`__proto__` keys.** Task IDs and tag names come from user files. An object keyed by them uses `Object.create(null)` or a `Map`, never `{}` (#276, #304, #307).
- **AI updates that wipe fields.** When the AI returns `null` or leaves a field out (details, priority, testStrategy, acceptanceCriteria, subtasks), keep the stored value. A failed AI call leaves the task as it was (#283, #286, MCP `expand_task --force`).
- **Secret paths.** AI calls go through `src/ai-providers/claude-code-path-guard.js`. A change there gets tests for Windows and macOS spellings, case, `//`, look-alike Unicode and `*-kubeconfig` style names, and must not allow any path that main refuses (#357, #389, #433, #469, #499).
- **Exit codes.** A command that failed exits non-zero, including partial failures such as `show 98,99` when no ID exists. A multi-ID command validates every ID before changing anything (#318).
- **ID types.** Stored top-level task IDs and dependency IDs are strings. In a subtask's dependencies, a bare number means a sibling subtask (#290, #383).

Free text you pass to a shell (prompts, notes, plugin command bodies) goes in single quotes, with `'` written as `'\''` (#298, #360).
