---
description: How TaskGraph CLI output should look, and where the code that prints it lives
paths:
  - "apps/cli/src/program.ts"
  - "scripts/modules/task-manager/**/*.js"
  - "apps/cli/src/ui/**/*.ts"
  - "apps/cli/src/commands/**/*.ts"
---

# CLI Output Guidelines

TaskGraph's output follows Apple's Human Interface Guidelines and Emil Kowalski's design principles, adapted to the terminal: say what happened, once, in as few lines as it takes, and make the next step obvious. Every rule below comes from cleanups that replaced boxed, repeated output (#140–#152). New output should look like those commands. The last boxes went in #318, and `boxen` is no longer a dependency.

## Where output code goes

- **Format in `apps/cli/src/ui/formatters/<name>-formatters.ts`.** A formatter is a pure function: data in, string out, no `console.log`. Export it from `apps/cli/src/ui/index.ts`. Legacy JS reaches it through `ui` from `@tm/cli`:

  ```javascript
  import { printError, ui } from '@tm/cli';

  console.log(ui.formatClearedSubtasks(result));
  ```

- **Core functions return data and print nothing.** The command (or the `outputFormat === 'text'` branch) prints the formatted result. `tmCore.tasks.clearSubtasks` returns `{ cleared, empty }`, and the `clear-subtasks` command prints it.
- **Test the formatter with a `.spec.ts` next to it.** Assert on plain text with ANSI codes stripped. Check line widths at 80 columns (and narrower when text wraps). Add an integration test against the built CLI for exit codes and stdout/stderr.
- Start each formatter file with a `@fileoverview` showing example output, as the existing formatters do.

## What good output looks like

```
✓ Cleared 4 subtasks from 2 tasks
  1  3 subtasks  Set up the database schema
  2  1 subtask   Build the login API
Task 3 had no subtasks
Run taskgraph expand --id=<id> to add new ones
```

- **Lead with the result.** One line starting with a green `✓`: `✓ Saved to task 3`, `✓ Analyzed 5 tasks · skipped 1 done`, `✓ Main model  sonnet → opus`. Don't use "Successfully", "Operation complete" or emoji (✅ ❌ 💾 🔍).
- **Details as aligned rows,** indented two spaces under the result. Cut titles to fit the terminal width (`terminalWidth()` from `apps/cli/src/ui/layout/helpers.ts`, which honors `COLUMNS` when output is piped), not to a fixed 14 or 30 characters.
- **Secondary facts are muted** (`theme.muted`), joined with ` · `: counts, dates, "with web research".
- **At most one next step,** as a plain line: `Next: taskgraph expand --all, or taskgraph complexity-report to see why`. Never a numbered "Next Steps" box.
- **Paths are relative to the project root:** `Saved to .taskgraph/reports/task-complexity-report.json`, not an absolute path that wraps.
- **Say each thing once.** No "Analyzing… / Analyzing complete / ✓ Analysis complete" sequences, and no printing the same message from both the core function and the command.
- **Don't confirm non-events.** If nothing changed, either say nothing or say it in one line (`The complexity report is unchanged`). Don't add a confirmation that repeats what the previous lines already showed.
- **No boxes.** A box makes everyday output look like an alert. Don't add `boxen` back, and don't draw boxes by hand.
- **No progress logs in normal output.** "Reading tasks from…", "AI service call complete" and "Found 6 tasks" go to `log('debug', …)`. Warnings and errors still print.
- **Fit 80 columns.** Wrap long text (reasoning, research answers) to the terminal width, capped at about 100 columns, with a hanging indent for list items.

## Errors

Use `printError(message, hint)` from `@tm/cli`, then exit 1:

```javascript
printError(
  `Task 9 doesn't exist in tag '${tag}'`,
  'Run `taskgraph list` to see task IDs'
);
process.exit(1);
```

It prints to stderr as `✗ <message>` with the hint muted underneath.

- **Say what's wrong in plain words,** with the value the user typed: `"abc" isn't a task ID`, not `Error: Invalid task ID format`.
- **The hint is the fix:** a command to run or an example of the right form.
- **Check input before any AI call or write,** so a typo doesn't cost a model call or leave half the work done (see `research` and `clear-subtasks`).
- **Print an error once.** If the core function throws, let the command print it. Don't also `console.error` it inside the core function.
- When a command did some of the work and then failed (saving after research, for example), print `✗ Couldn't save to task 9: <reason>` and set `process.exitCode = 1` rather than exiting.

## Waiting and prompts

- **AI calls show a spinner** (`createSpinner` from `apps/cli/src/ui/spinner.ts`) with a short label: `Analyzing 5 tasks…`. For waits over a few seconds, add the elapsed time (`Researching… 12s`). Stop the spinner in a `finally` block.
- **Print a result once, when it's complete.** Don't stream raw text and then print it again formatted.
- **Prompt only when stdin and stdout are terminals** (`process.stdin.isTTY && process.stdout.isTTY`). Scripts, CI and agents run without one: a prompt there hangs forever. For a read-only command, print an error with a hint instead of asking.
- **Use inquirer 14 prompt types:** `select`, `input`, `confirm`, `checkbox`. There's no `list` type; using it throws, and code that swallows the error hides the menu.
- **Ctrl-C prints one muted line** (`Cancelled; no models changed`), changes nothing, and exits 130. Create the prompt with `clearPromptOnDone: true` so a cancelled menu doesn't stay on screen, and print the answer line yourself (see `apps/cli/src/commands/models/prompts.ts`).
- **Start a choice on the current value,** so Enter keeps it.

## Colors

Text follows the terminal's own palette (see `apps/cli/src/ui/theme.ts`):

- `chalk.green` for `✓` and success, `chalk.red` for `✗`, `chalk.yellow` for warnings.
- `theme.brand` for highlights and commands, `theme.text` for body text, `theme.muted` for secondary text.
- Don't use `chalk.white`, `chalk.blue`, `chalk.gray` or `chalk.grey`. White is pale gray on many light themes, blue is hard to read on dark ones, and gray is bright black, nearly invisible on Solarized Dark.
- Don't name `'gray'` or `'grey'` as a color in options either (`createLink`'s `color`, `style.border`). Use `theme.muted`, `chalk.dim` or `TABLE_BORDER`.
- `tests/unit/scripts/theme-usage.test.js` and `apps/cli/src/ui/gray-usage.spec.ts` fail on these.

## Tables

Prefer aligned rows (`padEnd`) over `cli-table3`. A bordered table is right only for genuinely tabular data that the user scans across columns, like `list`. When you do use one:

- set `style: { border: TABLE_BORDER }` (cli-table3 defaults to gray)
- size columns to the terminal width
- never put long text, such as a whole prompt, in a narrow cell

## AI usage line

AI commands end with the muted line `ui.formatUsageLine(telemetryData)` returns (`sonnet · 13,735 tokens (12,188 in, 1,547 out) · 100% cached`). Don't print separate token or context tables; the usage line has the real counts.

## Before you open a PR

1. Run the command in a real terminal at 80 columns and capture the output before and after your change.
2. Check no line wraps mid-word and nothing prints twice.
3. Check Ctrl-C, a non-TTY run (`< /dev/null | cat`) and a bad argument.
4. Put the before/after captures and a Before | After | Why table in the PR body.
