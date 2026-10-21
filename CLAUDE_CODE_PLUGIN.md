# TaskGraph - Claude Code Plugin

This repository is a Claude Code plugin marketplace. The marketplace manifest is `.claude-plugin/marketplace.json`, and it lists one plugin, `taskgraph`, whose source is `packages/claude-code-plugin`.

The plugin adds TaskGraph's slash commands and agents to Claude Code. It needs the `taskgraph` CLI on your `PATH` (`npm install -g taskgraph-ai`) and a signed-in Claude Code. No API keys are required.

## Installation

### From GitHub

```txt
/plugin marketplace add stephennmiller/taskgraph-ai
/plugin install taskgraph@taskgraph
```

### Local development

The plugin is plain markdown, so there is no build step. From a clone of this repository, in Claude Code:

```txt
/plugin marketplace add .
/plugin install taskgraph@taskgraph
```

## What the plugin contains

```
taskgraph-ai/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace manifest (repo root)
└── packages/claude-code-plugin/
    ├── commands/               # 39 slash commands
    └── agents/                 # 3 agents
```

### Slash commands

The plugin provides 39 slash commands, invoked as `/taskgraph:<name>`. For example:

```txt
/taskgraph:parse-prd .taskgraph/docs/prd.md
/taskgraph:next-task
/taskgraph:show-task 3
/taskgraph:to-done 3
```

The plugin is the only way to get slash commands: `taskgraph init --rules claude` does not write any.

### Agents

- `task-orchestrator`: plans and coordinates work across tasks
- `task-executor`: implements a task
- `task-checker`: verifies a finished task (uses the `taskgraph show` CLI, or the MCP tool if you registered the server as `taskgraph-ai`)

The plugin does not register an MCP server. To add one, see the [README](README.md#4-optional-add-the-mcp-server).

## For contributors

To change the plugin, edit the files under `packages/claude-code-plugin/commands/` or `agents/`, then commit and push. Users get the update with:

```txt
/plugin marketplace update taskgraph
```

The marketplace version lives in `.claude-plugin/marketplace.json` under `metadata.version`. Increment it when you add or update plugins.

## Team configuration

Organizations can auto-install this marketplace for all team members by adding this to `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "taskgraph": {
      "source": {
        "source": "github",
        "repo": "stephennmiller/taskgraph-ai"
      }
    }
  },
  "enabledPlugins": {
    "taskgraph": {
      "marketplace": "taskgraph"
    }
  }
}
```

Team members who trust the repository folder will automatically get the marketplace and plugins installed.

## Documentation

- [Claude Code Plugin Docs](https://docs.claude.com/en/docs/claude-code/plugins)
- [Marketplace Documentation](https://docs.claude.com/en/docs/claude-code/plugin-marketplaces)
