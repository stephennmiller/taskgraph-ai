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
2. Without `--quick`, also check what TaskGraph needs: Node.js 22.13 or later (`node --version`) and a signed-in Claude Code (`claude --version`). TaskGraph runs its AI through Claude Code, so no API keys are needed.
3. Report the installed version in one line, and the next step: `/taskgraph:init-project` in a project without a `.taskgraph/` folder.

If the install fails:

- permission error: set a user-owned npm prefix (`npm config set prefix ~/.npm-global`, then add `~/.npm-global/bin` to `PATH`) and install again. Don't use `sudo` without asking the user.
- `command not found` after installing: the npm global bin folder isn't on `PATH`. `npm prefix -g` prints the folder; its `bin` goes on `PATH`.
