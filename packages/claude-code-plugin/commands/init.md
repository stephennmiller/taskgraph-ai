---
description: "TaskGraph: install the CLI if needed and set up TaskGraph in this project. Use to start tracking work."
argument-hint: "[--quick] [<prd-file>]"
---

Check that the `taskgraph` CLI is installed, install it if it isn't, and set up TaskGraph in this project.

Usage: `/taskgraph:init [--quick] [<prd-file>]`

Arguments: $ARGUMENTS

1. Check and install the CLI in one command:

   ```bash
   taskgraph --version 2>/dev/null || npm install -g taskgraph-ai
   taskgraph --version
   ```

   If the install fails:

   - permission error: point the user to npm's guide, <https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally>, then install again. Don't change their npm config yourself, and don't use `sudo` without asking the user.
   - `command not found` after installing: the npm global bin folder isn't on `PATH`. `npm prefix -g` prints the folder; its `bin` goes on `PATH`.

2. `taskgraph init` without `-y` asks questions in the terminal, which can't be answered from here, so always pass `-y` and turn the user's answers into flags.

   With `--quick`, `quick` or `-y`, ask nothing and run:

   ```bash
   taskgraph init -y
   ```

   Without it, first ask the user whether to commit the task files to Git, and, when `git rev-parse --is-inside-work-tree` fails, whether to start a Git repository here (`-y` alone runs `git init`). Then run `taskgraph init -y` with `--git-tasks` or `--no-git-tasks`, and `--git` or `--no-git` when you asked about the repository.
3. Show the output unchanged in a code block.
4. Without `--quick`, also check the rest of the setup:

   ```bash
   taskgraph doctor
   ```

   It prints a line per check (Node, Claude Code and its sign-in, the project, this plugin, the optional MCP server) and the fix under each `✗`. Pass each fix on to the user. TaskGraph runs its AI through Claude Code, so no API keys are needed.
5. If the arguments name a PRD file, go on with `/taskgraph:parse-prd <prd-file>`. Otherwise point out the next step `init` printed: write a PRD in `.taskgraph/docs/prd.md`, or add a first task with `/taskgraph:add-task`.
