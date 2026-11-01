# TaskGraph Installation Guide

This guide helps AI assistants install and configure TaskGraph for users in their development projects. TaskGraph supports Claude Code only.

## What is TaskGraph?

TaskGraph is an AI-driven task management system designed for development workflows. It breaks a PRD into dependency-aware tasks, tracks their status, and tells Claude Code what to work on next, keeping the plan and progress in the user's repo.

## Prerequisites

- [Claude Code](https://docs.claude.com/en/docs/claude-code) installed and signed in (the user has run `claude` once)
- Node.js 22.19 or later

TaskGraph needs no AI provider API keys. Every AI call runs through the user's signed-in Claude Code. The only optional key is `CLAUDE_CODE_API_KEY`, for billing calls to a specific Anthropic API key.

## Installation Steps

### Step 1: Install the CLI

```bash
npm install -g taskgraph-ai
```

This provides the `taskgraph` command and `taskgraph-mcp`, the optional MCP server. To skip the install, run commands through npx, for example `npx -y -p taskgraph-ai taskgraph list`.

### Step 2: Initialize the Project

From the user's project folder:

```bash
taskgraph init --yes
```

This creates `.taskgraph/` and imports TaskGraph's workflow guide from `CLAUDE.md`. It writes no `.mcp.json` unless you add `--mcp`. Do not run `init` twice; it only re-adds the same files. It does not install slash commands; the Claude Code plugin does (in Claude Code, run `/plugin marketplace add stephennmiller/taskgraph-ai`, then `/plugin install taskgraph@taskgraph`). The commands are then available as `/taskgraph:<name>`.

### Step 3: (Optional) Add the MCP Server

The slash commands and CLI cover the whole workflow. Add the MCP server only if the user wants to drive TaskGraph in plain language:

```bash
claude mcp add taskgraph-ai --scope user \
  --env TASKGRAPH_TOOLS=standard \
  -- npx -y taskgraph-ai
```

Or in the project's `.mcp.json`:

```json
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "taskgraph-ai@<version>"],
      "env": { "TASKGRAPH_TOOLS": "standard" }
    }
  }
}
```

Replace `<version>` with the one `taskgraph --version` prints. A pinned version means everyone who opens the project runs the same server, not whatever npm tags `latest` that day. `taskgraph init --mcp` writes a pinned entry for you, and running it again after an upgrade moves the pin.

`TASKGRAPH_TOOLS` controls how many tools are loaded: `core` (7, the default), `standard` (16) or `all`. `all` registers every tool and gives the MCP host full project control. Prefer `core` or `standard` unless the user needs a tool only `all` includes. Ask the user to restart Claude Code and run `/mcp` to confirm `taskgraph-ai` is connected.

### Step 4: Choose Models (Optional)

TaskGraph has three model roles, `main`, `research` and `fallback`. Each can be `opus`, `sonnet` or `haiku`:

```bash
taskgraph models --setup
taskgraph models --set-main sonnet
```

### Step 5: Create Initial Tasks

**Option A: Parse a PRD (recommended).** If the user has a Product Requirements Document:

```bash
taskgraph parse-prd .taskgraph/docs/prd.md
```

or `/taskgraph:parse-prd .taskgraph/docs/prd.md` in Claude Code. If the user has no PRD, help them write one and save it to `.taskgraph/docs/prd.md`.

**Option B: Start from scratch.**

```bash
taskgraph add-task --prompt="describe the task"
```

## Common Usage Patterns

### Daily Workflow

| Slash command | CLI |
|---|---|
| `/taskgraph:next` | `taskgraph next` |
| `/taskgraph:show <id>` | `taskgraph show <id>` |
| `/taskgraph:set-status <id> in-progress` | `taskgraph set-status --id=<id> --status=in-progress` |
| `/taskgraph:to-done <id>` | `taskgraph set-status --id=<id> --status=done` |

### Task Management

| Slash command | CLI |
|---|---|
| `/taskgraph:expand <id>` | `taskgraph expand --id=<id>` |
| `/taskgraph:add-task <description>` | `taskgraph add-task --prompt='...'` |
| `/taskgraph:analyze-complexity` | `taskgraph analyze-complexity` |
| `/taskgraph:update-task <id> <changes>` | `taskgraph update-task --id=<id> --prompt='...'` |

With the MCP server, the user can say the same things in plain language, such as "What's the next task I should work on?".

## Verification Steps

1. Run `taskgraph list`. It should show the project's tasks (or none yet).
2. Run `taskgraph models`. It should show the three model roles.
3. Run an AI command such as `taskgraph add-task --prompt="test task"`. If it fails, check that `claude` runs and is signed in.
4. If the MCP server was added, `/mcp` in Claude Code should list `taskgraph-ai` as connected.

## Troubleshooting

**If the MCP server doesn't start:**

- Verify the JSON configuration is valid
- Check that Node.js 22.19 or later is installed
- Confirm `npx -y taskgraph-ai` starts on its own in a terminal (it waits for input; press Ctrl+C to stop)

**If AI commands fail:**

- Run `claude` once and make sure the user is signed in
- Run `taskgraph models` and confirm the roles are set to `opus`, `sonnet` or `haiku`

**If a project came from Task Master or a release before 0.47:** rename `.taskmaster/` to `.taskgraph/` by hand and rename any `TASK_MASTER_*` or `TASKMASTER_*` environment variables to `TASKGRAPH_*`. `taskgraph migrate` and `.taskmasterconfig` no longer exist. See the upgrade guide in `apps/docs/upgrading.mdx`.

## Next Steps

Once installed, users can:

- Create tasks with `add-task` or parse a PRD with `parse-prd`
- Break tasks into subtasks with `expand` and `expand --all`
- Analyze complexity with `analyze-complexity`
- Organize work with tags (`taskgraph tags`)
- Run `taskgraph help` to see every command

For detailed documentation, see the Mintlify docs source in `apps/docs/`.
