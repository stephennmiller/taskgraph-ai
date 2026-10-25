---
description: "TaskGraph: check the taskgraph CLI is installed, and install it if not."
argument-hint: "[--quick]"
---

Check that the `taskgraph` CLI is installed, and install it if it isn't.

Usage: `/taskgraph:install-taskgraph [--quick]`

Arguments: $ARGUMENTS

1. Check and install in one command:

   ```bash
   taskgraph --version 2>/dev/null || npm install -g taskgraph-ai
   taskgraph --version
   ```

   With `--quick`, stop here and report the version.
2. Without `--quick`, also check the rest of the setup:

   ```bash
   taskgraph doctor
   ```

   It prints a line per check (Node, Claude Code and its sign-in, the project, this plugin, the optional MCP server) and the fix under each `✗`. Pass each fix on to the user. TaskGraph runs its AI through Claude Code, so no API keys are needed.
3. Report the installed version in one line, and the next step: `/taskgraph:init-project` in a project without a `.taskgraph/` folder.

If the install fails:

- permission error: point the user to npm's guide, <https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally>, then install again. Don't change their npm config yourself, and don't use `sudo` without asking the user.
- `command not found` after installing: the npm global bin folder isn't on `PATH`. `npm prefix -g` prints the folder; its `bin` goes on `PATH`.
