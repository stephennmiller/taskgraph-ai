---
description: How a CLI command is built, named, validated and registered
paths:
  - "apps/cli/src/program.ts"
  - "apps/cli/src/command-registry.ts"
  - "apps/cli/src/commands/**/*.ts"
---

# CLI commands

The CLI is TaskGraph's main interface; the MCP server is optional. A command
is a thin layer over `@tm/core` (see "Business Logic Separation" in
[CLAUDE.md](../../CLAUDE.md)). How output looks is in [ui.md](ui.md);
commands that delete data are in
[commands-removal.md](commands-removal.md). Copy the nearest existing
command, such as `note.command.ts` or `removal.command.ts`.

## Structure

- One file per command (or small family) in `apps/cli/src/commands/`,
  named `<name>.command.ts`. The class extends Commander's `Command` and
  sets its arguments, options and action in the constructor.
- Register it in the `commands` array in
  [`command-registry.ts`](../../apps/cli/src/command-registry.ts) with a
  `name`, `description`, `commandClass` and `category`. Shell completion
  reads the Commander program; the `taskgraph --help` screen doesn't, so
  give a visible command a row in `HELP_GROUPS`
  (`apps/cli/src/ui/formatters/help-formatters.ts`). `program.spec.ts`
  fails without one. The row, the registry entry and the class's own
  `.description()` are the same sentence (#1149); the spec fails when they
  differ.
- Run the work with `withTmCore(options, async (tmCore) => ...)` from
  `apps/cli/src/utils/with-tm-core.ts`. It opens a TmCore for `--project`,
  prints the `[tag] X` line, prints any error through `displayError`, sets
  `process.exitCode = 1` and closes the TmCore. A command that skips the
  header calls `createTmCore` itself and does the same.
- The action parses arguments, calls a `tmCore` method and prints the
  result with a formatter from `apps/cli/src/ui/formatters/`. ID parsing,
  validation of task data, file I/O and AI calls belong in `@tm/core`.

## Options

- Command and option names are kebab-case; Commander hands them to the
  action as camelCase (`--num-tasks` is `options.numTasks`).
- `-p` is `--project` in every command (#882), so `--prompt` and `--parent`
  have no short form. Every command that reads a project takes it: add it
  with `projectOption()` and the tag with `tagOption()`
  (`utils/shared-options.ts`), so each is worded once, and pass
  `options.project` to `getProjectRoot` (#1149). `program.spec.ts` fails on
  a command without `--project` or with its own `--tag` sentence.
- Use the name other commands use for the same thing. `jsonOption()` from
  `utils/json-output.ts` adds `--json` as shorthand for `--format json`
  (`json-alias.spec.ts` checks every command with `--format`); print the
  payload with `printJson` so it carries `schemaVersion`.
- A task ID is accepted as an argument and as `--id` (`pickId` in
  `utils/id-argument.ts`, #926). Any other value a command can't run
  without (`add-subtask <parent>`, `move <from> <to>`, `add-task <title>`)
  is an argument too, with its flag kept; `pickValue` refuses two different
  values (#1149).
- Write option text in the voice of [ui.md](ui.md): what the option does,
  in a few plain words. A flag that repeats an argument says `The same as
  the [id] argument`.
- An old flag a script may still pass stays as a hidden option
  (`new Option(...).hideHelp()`), such as `legacyFileOption()` for `-f`.

## Validation and exit codes

- Check input before any AI call or write. On bad input call
  `printError(message, hint)` from `utils/error-handler.ts` with the value
  the user typed and a hint that fixes it, then `process.exit(1)`.
- Once work has started, a failure (including a partial one) sets
  `process.exitCode = 1` and returns, so cleanup still runs. See
  [robustness.md](robustness.md) for multi-ID commands.
- Let Commander's own errors reach `runCLI` in `program.ts`, which formats
  them with `formatCommanderError` and its "Did you mean" hint. Don't call
  `.allowUnknownOption()` or print a custom usage box; `--help` is generated.

## Renamed and removed commands

- A renamed command keeps its old name as a hidden alias so scripts keep
  working. The alias class calls `noticeOldAlias(this, '<new usage>')` from
  `utils/alias-notice.ts`, which prints one dim line on stderr before it
  runs (#930).
- Hide it with `hidden: true` in its registry entry. A class with its own
  `static register` ignores that flag and passes `{ hidden: true }` to
  `program.addCommand` itself.
- A command that `loop` replaced goes in `REMOVED_COMMANDS` in
  `utils/error-handler.ts` (the value is the extra `loop` flags), so typing
  it prints `Run taskgraph loop -n 1 --id <id>...`. Any other replacement
  needs its own hint in `formatCommanderError`.

## Startup time

The registry imports every command module, so a command file's top-level
imports run on every `taskgraph` call. Import heavy packages (AI SDKs,
markdown, inquirer) inside the function that uses them, as `confirm()` in
`removal.command.ts` does with inquirer. The budget and the
`HEAVY_PACKAGES` check are in "Code Quality" in [CLAUDE.md](../../CLAUDE.md).

## Update check

`runCLI` checks for a new version before the command runs. It notifies,
and installs and restarts only when the user opted in to auto-install;
`taskgraph upgrade` installs. When the check is skipped (no
terminal, CI, `--json`, loop children and others) is decided in
`apps/cli/src/utils/auto-update/policy.ts`.
