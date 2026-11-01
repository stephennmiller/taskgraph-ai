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
    ├── commands/               # 29 slash commands
    └── agents/                 # 2 agents
```

### Slash commands

The plugin provides 29 slash commands, invoked as `/taskgraph:<name>`. Each is named after the `taskgraph` CLI command it runs (`/taskgraph:next` runs `taskgraph next`), except `to-done`, which checks a task's acceptance criteria against your changes before closing it, and `project-status`. `/taskgraph:help` lists them. For example:

```txt
/taskgraph:parse-prd .taskgraph/docs/prd.md
/taskgraph:next
/taskgraph:show 3
/taskgraph:to-done 3
```

The plugin is the only way to get slash commands: `taskgraph init --rules claude` does not write any.

### Agents

- `task-executor`: implements a task
- `task-checker`: verifies a finished task (uses the `taskgraph show` CLI, or the MCP tool if you registered the server as `taskgraph-ai`)

The plugin does not register an MCP server. To add one, see the [README](README.md#4-optional-add-the-mcp-server).

## For contributors

To change the plugin, edit the files under `packages/claude-code-plugin/commands/` or `agents/`, then commit and push. Users get the update with:

```txt
/plugin marketplace update taskgraph
```

The marketplace version lives in `.claude-plugin/marketplace.json` under `metadata.version`. Increment it when you add or update plugins.

The plugin's own `version` in `packages/claude-code-plugin/.claude-plugin/plugin.json` is the release version: the release workflow bumps it with `package.json`, and Claude Code only updates an installed plugin when it changes. Don't edit it by hand. Because of this, a change to the plugin reaches installed copies only with the next release, so give a PR that changes the plugin a `fix:` or `feat:` title, not `docs:` or `chore:`. `metadata.taskgraphCli` in the same file is the oldest CLI the plugin works with, as `>=x.y.z`. Raise it when a command body or hook starts using a CLI command or flag that older releases lack. A hook may call a newer flag before then only if it prints nothing on a CLI without it, tested against an old CLI; list that call in `OPTIONAL_HOOK_CALLS` in `plugin-cli-range.test.ts` until the minimum has it. CI checks this against `packages/tm-profiles/tests/integration/plugin-cli-surface.json`, the commands and flags of the range's minimum; when you raise the range, regenerate that file from the new minimum's tag with `node packages/tm-profiles/tests/integration/cli-surface.ts v<x.y.z>`. The minimum must be a release already on npm's `latest` dist-tag, not only on `next`: the update message tells users to install `taskgraph-ai@latest`. The SessionStart hook passes the plugin folder to `taskgraph prime --plugin-root`, which tells Claude to have the user update when the CLI is older, and `taskgraph doctor` checks the same range.

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
