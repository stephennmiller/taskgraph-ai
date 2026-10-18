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
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20with%20Commons%20Clause-blue.svg" alt="License"></a>
</p>

TaskGraph turns a product requirements document (PRD) into a dependency-aware task list, then walks Claude Code through it one task at a time. You describe what to build, TaskGraph plans the work, and Claude Code implements it, with the plan and progress stored in your repo.

- **Plan from a PRD:** generate tasks and subtasks, with dependencies, priorities and test strategies.
- **Always know what's next:** `next` picks the first unblocked task.
- **Stay in Claude Code:** use slash commands (`/tm:next-task`) or the `taskgraph` CLI. An MCP server is available if you want plain-language control, but it is optional.
- **No API keys:** every AI call runs through your signed-in Claude Code.

> **Attribution:** TaskGraph is based on [Task Master](https://github.com/eyaltoledano/claude-task-master) by Eyal Toledano ([@eyaltoledano](https://x.com/eyaltoledano)) and Ralph Khreish ([@RalphEcom](https://x.com/RalphEcom)). It is named `taskgraph-ai` with `taskgraph` and `taskgraph-mcp` binaries, so it can sit next to the original, and it keeps the original license and copyright notices (see [Licensing](#licensing)). Existing `.taskmaster/` project folders work unchanged.

## Contents

[Set up in Claude Code](#set-up-in-claude-code) · [How to use it](#how-to-use-it) · [Commands](#commands) · [MCP tool tiers](#mcp-tool-tiers) · [Models](#models) · [Troubleshooting](#troubleshooting) · [Docs](#documentation) · [Licensing](#licensing)

## Set up in Claude Code

You need [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (run `claude` once) and Node.js 22 or later.

### 1. Install

```bash
npm install -g taskgraph-ai
```

This gives you the `taskgraph` command (the CLI) and `taskgraph-mcp`, the optional MCP server. To skip the install, run any command through npx, for example `npx -y -p taskgraph-ai taskgraph list`. To build from source instead, see [Working on TaskGraph itself](#troubleshooting).

### 2. Initialize your project

From your own project folder:

```bash
taskgraph init --rules claude
```

This creates `.taskgraph/` (tasks, docs, config), a `CLAUDE.md` import with TaskGraph's workflow guide, and 46 slash commands in `.claude/commands/tm/`. Don't run it twice; it only re-adds the same files.

`init` also writes a `.mcp.json` that registers the MCP server with the 7 `core` tools. Delete that file if you only want the slash commands and CLI; see step 4 to keep and configure the server.

### 3. (Optional) Install the plugin

The plugin adds a nearly identical set of 46 slash commands (as `/taskgraph:<name>`) and three agents (`task-orchestrator`, `task-executor`, `task-checker`).

```txt
/plugin marketplace add stephennmiller/taskgraph-ai
/plugin install taskgraph@taskgraph
```

The plugin does not register an MCP server. The `task-checker` agent uses the `taskgraph show` CLI, and uses the MCP tool instead if you registered the server as `taskgraph-ai` (step 4). Its slash commands overlap with the ones from step 2, so install the plugin only if you want the agents.

### 4. (Optional) Add the MCP server

Skip this unless you want to drive TaskGraph in plain language. Slash commands and the CLI do everything without it.

```bash
claude mcp add taskgraph-ai --scope user \
  --env TASKGRAPH_TOOLS=standard \
  -- npx -y taskgraph-ai
```

Restart Claude Code and run `/mcp`; `taskgraph-ai` should show as connected. `standard` loads 14 tools, enough for everything in [How to use it](#how-to-use-it). See [MCP tool tiers](#mcp-tool-tiers) for the others.

To share the setup with your team instead, put it in the project's `.mcp.json`:

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

## How to use it

The examples below use slash commands (`/tm:...`), with the CLI equivalent in each table. If you added the optional MCP server, you can say the same things in plain language instead.

### 1. Write a PRD

Create `.taskgraph/docs/prd.md` describing what you want to build. The more detail you give, the better the tasks. Skipping the PRD is fine for small jobs; just ask Claude to add a task.

### 2. Generate tasks

```txt
/tm:parse-prd .taskgraph/docs/prd.md
```

Then, optionally, check how big each task is and break the big ones down:

```txt
/tm:analyze-complexity
/tm:expand-all-tasks
```

### 3. Work through them

| Slash command | CLI | What happens |
|---|---|---|
| `/tm:next-task` | `taskgraph next` | Shows the first unblocked, pending task |
| `/tm:show-task 1` | `taskgraph show 1,3,5` | Full details for each task |
| `/tm:to-in-progress 3`, then ask Claude to implement it | `taskgraph set-status --id=3 --status=in-progress` | Claude Code does the work, guided by the task |
| `/tm:to-done 3` | `taskgraph set-status --id=3 --status=done` | Updates status and unlocks dependent tasks |
| `/tm:expand-task 4` | `taskgraph expand --id=4` | Splits it into subtasks |
| `/tm:add-task <what you want>` | `taskgraph add-task --prompt="..."` | Creates a task with AI help |
| `/tm:update-task 5 we now use Postgres` | `taskgraph update-task --id=5 --prompt="..."` | Rewrites it for the new direction |
| (CLI only) | `taskgraph research "JWT best practices"` | Web research with project context |

The loop is simple: **next, implement, done, next.** Task IDs look like `3` for a task and `3.2` for a subtask.

If you use the MCP server instead, research, tags and the dependency tools are only loaded with `TASKGRAPH_TOOLS=all` (see [MCP tool tiers](#mcp-tool-tiers)); everything else here works with `standard`.

### 4. Keep it organized

- **Tags** keep separate task lists per branch, feature or experiment: `taskgraph tags`, `taskgraph tags add`, `taskgraph tags use` (MCP: `list_tags`, `add_tag`, `use_tag`).
- **Dependencies** decide what counts as "next". Run `/tm:validate-dependencies` or `/tm:fix-dependencies` if the graph looks wrong.
- **Statuses:** `pending`, `in-progress`, `done`, `review`, `deferred`, `cancelled`.

## Commands

Slash commands and the `taskgraph` CLI cover everything. The MCP server (optional) lets you do the same in plain language.

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

Only relevant if you added the optional MCP server. Each tool you load costs context. `TASKGRAPH_TOOLS` controls how many are registered. If it's unset, you get `core`.

| Value | Tools | Includes |
|---|---|---|
| `core` (default, alias `lean`) | 7 | `get_tasks`, `next_task`, `get_task`, `set_task_status`, `update_subtask`, `parse_prd`, `expand_task` |
| `standard` | 14 | core, plus `initialize_project`, `analyze_project_complexity`, `expand_all`, `add_subtask`, `remove_task`, `add_task`, `complexity_report` |
| `all` | 43 | everything: updates, dependencies, tags, `research`, `move_task`, `scope_up_task`, `scope_down_task`, `generate`, and the `autopilot_*` TDD workflow |
| a list | custom | e.g. `get_tasks,next_task,set_task_status` |

Set it when you add the server:

```bash
claude mcp add taskgraph-ai --scope user \
  --env TASKGRAPH_TOOLS=all \
  -- npx -y taskgraph-ai
```

Or edit the `env` block in `.mcp.json`, then restart Claude Code.

## Models

TaskGraph uses three roles: **main**, **research** and **fallback** (used if either of the others fails). The choices are `opus`, `sonnet` and `haiku`. The research role gets web search and fetch only. It cannot read or change your files and has no shell.

In Claude Code, say `Change the main model to opus`, or run `taskgraph models --setup`. Details are in [Models](docs/models.md) and the [Claude Code guide](docs/examples/claude-code-usage.md).

## Troubleshooting

- **`0 tools enabled` or the server won't connect:** restart Claude Code, run `/mcp`, and confirm `npx -y taskgraph-ai` starts on its own in a terminal (it waits for input; press Ctrl+C to stop).
- **Working on TaskGraph itself:** build from source with `git clone https://github.com/stephennmiller/taskgraph-ai.git && cd taskgraph-ai && npm install && npm run build`, then run `node dist/taskgraph.js` for the CLI. This repository's own `.mcp.json` starts `dist/mcp-server.js` relative to the repo, so run `npm run build` first or the server won't connect.
- **AI commands fail:** run `claude` once and make sure you're signed in.
- **Fewer tools than expected:** `TASKGRAPH_TOOLS` defaults to `core`. Set `standard` or `all`.
- **Commands behave oddly after `git pull`:** run `npm run build` again; the CLI and server run from `dist/`.
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
