<a name="readme-top"></a>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./images/taskgraph-logo-dark.png">
    <img src="./images/taskgraph-logo.png" alt="TaskGraph logo" width="640">
  </picture>
</p>

<p align="center">
<b>TaskGraph</b>: task management for AI-driven development, built for Claude Code.
</p>

<p align="center">
  <a href="https://github.com/stephennmiller/taskgraph-ai/actions/workflows/ci.yml"><img src="https://github.com/stephennmiller/taskgraph-ai/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/taskgraph-ai"><img src="https://badge.fury.io/js/taskgraph-ai.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20with%20Commons%20Clause-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/package/taskgraph-ai"><img src="https://img.shields.io/npm/dm/taskgraph-ai?style=flat" alt="NPM Downloads"></a>
</p>

TaskGraph turns a product requirements document (PRD) into a dependency-aware task list, then walks Claude Code through it one task at a time. You describe what to build, TaskGraph plans the work, and Claude Code implements it, with the plan and progress stored in your repo.

- **Plan from a PRD:** generate tasks and subtasks, with dependencies, priorities and test strategies.
- **Always know what's next:** `next` picks the first unblocked task.
- **Stay in Claude Code:** talk to it in plain language over MCP, or use slash commands.
- **No API keys:** every AI call runs through your signed-in Claude Code.

> **Attribution:** TaskGraph is based on [Task Master](https://github.com/eyaltoledano/claude-task-master) by Eyal Toledano ([@eyaltoledano](https://x.com/eyaltoledano)) and Ralph Khreish ([@RalphEcom](https://x.com/RalphEcom)). It is published as `taskgraph-ai` with the `taskgraph` and `taskgraph-mcp` binaries, so it installs next to the original, and it keeps the original license and copyright notices (see [Licensing](#licensing)). Existing `.taskmaster/` project folders work unchanged.

## Contents

[Set up in Claude Code](#set-up-in-claude-code) · [How to use it](#how-to-use-it) · [Commands](#commands) · [MCP tool tiers](#mcp-tool-tiers) · [Models](#models) · [Troubleshooting](#troubleshooting) · [Docs](#documentation) · [Licensing](#licensing)

## Set up in Claude Code

You need [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (run `claude` once) and Node.js 18 or later.

### 1. Add the MCP server (recommended)

```bash
claude mcp add taskgraph-ai -- npx -y taskgraph-ai
```

Restart Claude Code and run `/mcp` to check that `taskgraph-ai` is connected. This loads the 7 core tools, which is enough for daily use. To load more, see [MCP tool tiers](#mcp-tool-tiers).

To share the setup with your team, put it in the project's `.mcp.json` instead:

```json
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "taskgraph-ai"],
      "env": { "TASKGRAPH_TOOLS": "standard" }
    }
  }
}
```

### 2. Initialize your project

In Claude Code, say:

```txt
Initialize taskgraph in my project
```

This creates a `.taskgraph/` folder for tasks, docs and config. Don't run it twice; it only re-adds the same files.

### 3. (Optional) Add slash commands to the project

```bash
npx taskgraph-ai init --rules claude   # or: taskgraph init --rules claude
```

This adds a `CLAUDE.md` import with TaskGraph's workflow guide and slash commands under `.claude/commands/tm/`. See [Commands](#commands).

### 4. (Optional) Install the plugin

The Claude Code plugin adds 46 slash commands and three agents (`task-orchestrator`, `task-executor`, `task-checker`), and registers the TaskGraph MCP server for you.

```txt
/plugin marketplace add stephennmiller/taskgraph-ai
/plugin install taskgraph@taskgraph
```

If you install the plugin, skip step 1 so the server isn't registered twice. Its server uses the default `core` tools; see [MCP tool tiers](#mcp-tool-tiers) to load more.

### CLI install (alternative)

```bash
npm install -g taskgraph-ai   # global
taskgraph init                # then run in your project
```

## How to use it

### 1. Write a PRD

Create `.taskgraph/docs/prd.md` describing what you want to build. The more detail you give, the better the tasks. Skipping the PRD is fine for small jobs; just ask Claude to add a task.

### 2. Generate tasks

```txt
Parse my PRD at .taskgraph/docs/prd.md
```

Then, optionally, check how big each task is and break the big ones down:

```txt
Analyze the complexity of my tasks, then expand them
```

### 3. Work through them

| Say this in Claude Code | What happens |
|---|---|
| `What's the next task I should work on?` | Shows the first unblocked, pending task |
| `Show me tasks 1, 3 and 5` | Full details for each |
| `Implement task 3` | Claude Code does the work, guided by the task |
| `Mark task 3 as done` | Updates status and unlocks dependent tasks |
| `Expand task 4` | Splits it into subtasks |
| `Add a task to <what you want>` | Creates a task with AI help |
| `Update task 5: we now use Postgres` | Rewrites it for the new direction |
| `Research JWT best practices for our API in src/api.js` | Web research with project context |

The loop is simple: **next, implement, done, next.** Task IDs look like `3` for a task and `3.2` for a subtask.

### 4. Keep it organized

- **Tags** keep separate task lists per branch, feature or experiment: `list_tags`, `add_tag`, `use_tag`.
- **Dependencies** decide what counts as "next". Run `validate_dependencies` or `fix_dependencies` if the graph looks wrong.
- **Statuses:** `pending`, `in-progress`, `done`, `review`, `deferred`, `cancelled`.

## Commands

You can do everything three ways: in plain language over MCP (above), with slash commands, or with the `taskgraph` CLI.

### Slash commands

After `taskgraph init --rules claude` they appear as `/tm:<name>` (type `/tm` to see them). The plugin provides the same set as `/taskgraph:<name>`.

| Purpose | Commands |
|---|---|
| Set up | `init-project`, `init-project-quick`, `install-taskgraph`, `setup-models`, `view-models` |
| Plan | `parse-prd`, `parse-prd-with-research`, `analyze-complexity`, `complexity-report`, `analyze-project` |
| See | `list-tasks`, `list-tasks-by-status`, `list-tasks-with-subtasks`, `next-task`, `show-task`, `project-status` |
| Change status | `to-pending`, `to-in-progress`, `to-done`, `to-review`, `to-deferred`, `to-cancelled` |
| Edit | `add-task`, `update-task`, `update-single-task`, `update-tasks-from-id`, `remove-task`, `convert-task-to-subtask` |
| Subtasks | `expand-task`, `expand-all-tasks`, `add-subtask`, `remove-subtask`, `remove-subtasks`, `remove-all-subtasks` |
| Dependencies | `add-dependency`, `remove-dependency`, `validate-dependencies`, `fix-dependencies` |
| Workflows | `smart-workflow`, `command-pipeline`, `auto-implement-tasks`, `sync-readme`, `learn`, `help` |

### CLI cheat sheet

```bash
taskgraph parse-prd .taskgraph/docs/prd.md   # generate tasks from a PRD
taskgraph list                               # all tasks and their status
taskgraph next                               # next task to work on
taskgraph show 1,3,5                         # one or more tasks
taskgraph set-status --id=3 --status=done    # change status
taskgraph add-task --prompt="..." --research # add a task
taskgraph expand --id=4 --research           # split into subtasks
taskgraph expand --all                       # expand every eligible task
taskgraph update-task --id=5 --prompt="..."  # change one task
taskgraph update --from=5 --prompt="..."     # change task 5 onward
taskgraph update-subtask --id=3.2 --prompt="notes"
taskgraph analyze-complexity --research
taskgraph complexity-report
taskgraph add-dependency --id=5 --depends-on=3
taskgraph validate-dependencies
taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress
taskgraph research "latest JWT best practices"
taskgraph models --setup                     # choose models
```

Every command, flag and example is in the [command reference](docs/command-reference.md).

## MCP tool tiers

Each tool you load costs context. `TASKGRAPH_TOOLS` controls how many are registered. If it's unset, you get `core`.

| Value | Tools | Includes |
|---|---|---|
| `core` (default, alias `lean`) | 7 | `get_tasks`, `next_task`, `get_task`, `set_task_status`, `update_subtask`, `parse_prd`, `expand_task` |
| `standard` | 14 | core, plus `initialize_project`, `analyze_project_complexity`, `expand_all`, `add_subtask`, `remove_task`, `add_task`, `complexity_report` |
| `all` | 42 | everything: updates, dependencies, tags, `research`, `move_task`, `scope_up_task`, `scope_down_task`, `generate`, and the `autopilot_*` TDD workflow |
| a list | custom | e.g. `get_tasks,next_task,set_task_status` |

Set it when you add the server:

```bash
claude mcp add taskgraph-ai --scope user \
  --env TASKGRAPH_TOOLS=standard \
  -- npx -y taskgraph-ai@latest
```

Or edit the `env` block in `.mcp.json`, then restart Claude Code.

## Models

TaskGraph uses three roles: **main**, **research** and **fallback** (used if either of the others fails). The choices are `opus`, `sonnet` and `haiku`. The research role gets web search and fetch only. It cannot read or change your files and has no shell.

In Claude Code, say `Change the main model to opus`, or run `taskgraph models --setup`. Details are in [Models](docs/models.md) and the [Claude Code guide](docs/examples/claude-code-usage.md).

## Troubleshooting

- **`0 tools enabled` or the server won't connect:** restart Claude Code, run `/mcp`, and confirm `npx -y taskgraph-ai` starts on its own in a terminal.
- **AI commands fail:** run `claude` once and make sure you're signed in.
- **Fewer tools than expected:** `TASKGRAPH_TOOLS` defaults to `core`. Set `standard` or `all`.
- **`taskgraph init` doesn't respond:** run `node node_modules/taskgraph-ai/scripts/init.js`.
- **Task files look out of sync:** run `taskgraph fix-dependencies`, or ask Claude to fix dependencies.
- Don't hand-edit `.taskgraph/tasks/tasks.json` or `.taskgraph/config.json`; use the commands.

## Documentation

[Tutorial](docs/tutorial.md) · [Command reference](docs/command-reference.md) · [Configuration](docs/configuration.md) · [Task structure](docs/task-structure.md) · [Examples](docs/examples.md) · [Models](docs/models.md) · [Plugin](CLAUDE_CODE_PLUGIN.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

## Contributors

<a href="https://github.com/stephennmiller/taskgraph-ai/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stephennmiller/taskgraph-ai" alt="TaskGraph project contributors" />
</a>

## Licensing

TaskGraph is licensed under the MIT License with Commons Clause, the same license as Task Master.

**Allowed:** use it for any purpose (personal, commercial, academic), modify it, distribute copies, and sell products built with it.

**Not allowed:** selling TaskGraph itself, offering it as a hosted service, or creating competing products based on it.

See [LICENSE](LICENSE) and [licensing details](docs/licensing.md).
