<a name="readme-top"></a>

<div align='center'>
</div>

<p align="center">
  <img src="./images/logo.png?raw=true" alt="Taskmaster logo">
</p>

<p align="center">
<b>Taskmaster</b>: A task management system for AI-driven development, designed to work seamlessly with any AI chat.
</p>

<p align="center">
  <a href="./docs/README.md">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/stephennmiller/taskgraph-ai/actions/workflows/ci.yml"><img src="https://github.com/stephennmiller/taskgraph-ai/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://badge.fury.io/js/taskgraph-ai"><img src="https://badge.fury.io/js/taskgraph-ai.svg" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT%20with%20Commons%20Clause-blue.svg" alt="License"></a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/taskgraph-ai"><img src="https://img.shields.io/npm/d18m/taskgraph-ai?style=flat" alt="NPM Downloads"></a>
  <a href="https://www.npmjs.com/package/taskgraph-ai"><img src="https://img.shields.io/npm/dm/taskgraph-ai?style=flat" alt="NPM Downloads"></a>
  <a href="https://www.npmjs.com/package/taskgraph-ai"><img src="https://img.shields.io/npm/dw/taskgraph-ai?style=flat" alt="NPM Downloads"></a>
</p>

> **TaskGraph** is based on [Task Master](https://github.com/eyaltoledano/claude-task-master) by Eyal Toledano and Ralph Khreish. It is published as `taskgraph-ai` with the `taskgraph` and `taskgraph-mcp` binaries so it can be installed next to the original `task-master-ai`, and it keeps the original license and copyright notices (see [Licensing](#licensing)). Existing `.taskmaster/` project folders work unchanged.

## Originally by [@eyaltoledano](https://x.com/eyaltoledano) & [@RalphEcom](https://x.com/RalphEcom)

[![Twitter Follow](https://img.shields.io/twitter/follow/eyaltoledano)](https://x.com/eyaltoledano)
[![Twitter Follow](https://img.shields.io/twitter/follow/RalphEcom)](https://x.com/RalphEcom)

A task management system for AI-driven development with Claude, built for Claude Code.

## Documentation

**[View the documentation](docs/README.md)**

### Quick Links

- [Tutorial](docs/tutorial.md)
- [Command Reference](docs/command-reference.md)
- [Configuration](docs/configuration.md)
- [Task Structure](docs/task-structure.md)
- [Examples](docs/examples.md)
- [Models](docs/models.md)
- [Migration Guide](docs/migration-guide.md)
- [Changelog](CHANGELOG.md)

#### Claude Code Quick Install

For Claude Code users:

```bash
claude mcp add taskgraph-ai -- npx -y taskgraph-ai
```

## Requirements

Task Master uses [Claude Code](https://docs.claude.com/en/docs/claude-code) for every AI call, so there are no API keys to manage. Install Claude Code and sign in (run `claude` once) before using the AI commands.

You can define 3 models: the main model, the research model, and the fallback model (used if either of the others fails). The available models are `opus`, `sonnet` and `haiku`.

The research model runs with web search and fetch access only. It cannot read or change your files and has no shell access.

## Quick Start

### Option 1: MCP (Recommended)

MCP (Model Context Protocol) lets you run Task Master directly from Claude Code.

#### 1. Add Task Master to Claude Code

Register the server with the Claude Code CLI (shown above), or add it to the project's `.mcp.json` (`taskgraph init --rules claude` writes this file for you).

##### Manual Configuration

```json
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "taskgraph-ai"],
      "env": {
        // "TASK_MASTER_TOOLS": "all" // Options: "all", "standard", "core", or comma-separated list of tools
      }
    }
  }
}
```

> **Note**: If you see `0 tools enabled` in the MCP settings, restart Claude Code and check the server with `/mcp`.

#### 2. (Optional) Configure the models you want to use

In Claude Code, say:

```txt
Change the main, research and fallback models to <model_name>, <model_name> and <model_name> respectively.
```

For example:
```txt
Change the main model to opus
```

[Table of available models](docs/models.md) | [Claude Code setup](docs/examples/claude-code-usage.md)

#### 3. Initialize Task Master

In Claude Code, say:

```txt
Initialize taskmaster-ai in my project
```

#### 4. Make sure you have a PRD (Recommended)

For **new projects**: Create your PRD at `.taskmaster/docs/prd.txt`.
For **existing projects**: You can use `scripts/prd.txt` or migrate with `taskgraph migrate`

An example PRD template is available after initialization in `.taskmaster/templates/example_prd.txt`.

> [!NOTE]
> While a PRD is recommended for complex projects, you can always create individual tasks by asking "Can you help me implement [description of what you want to do]?" in chat.

**Always start with a detailed PRD.**

The more detailed your PRD, the better the generated tasks will be.

#### 5. Common Commands

Use Claude Code to:

- Parse requirements: `Can you parse my PRD at scripts/prd.txt?`
- Plan next step: `What's the next task I should work on?`
- Implement a task: `Can you help me implement task 3?`
- View multiple tasks: `Can you show me tasks 1, 3, and 5?`
- Expand a task: `Can you help me expand task 4?`
- **Research fresh information**: `Research the latest best practices for implementing JWT authentication with Node.js`
- **Research with context**: `Research React Query v5 migration strategies for our current API implementation in src/api.js`

[More examples on how to use Task Master in chat](docs/examples.md)

### Option 2: Using Command Line

#### Installation

```bash
# Install globally
npm install -g taskgraph-ai

# OR install locally within your project
npm install taskgraph-ai
```

#### Initialize a new project

```bash
# If installed globally
taskgraph init

# If installed locally
npx taskgraph init

# Set up the Claude Code integration (CLAUDE.md import, .mcp.json, slash commands)
taskgraph init --rules claude
```

This will prompt you for project details and set up a new project with the necessary files and structure.

#### Common Commands

```bash
# Initialize a new project
taskgraph init

# Parse a PRD and generate tasks
taskgraph parse-prd your-prd.txt

# List all tasks
taskgraph list

# Show the next task to work on
taskgraph next

# Show specific task(s) - supports comma-separated IDs
taskgraph show 1,3,5

# Research fresh information with project context
taskgraph research "What are the latest best practices for JWT authentication?"

# Move tasks between tags (cross-tag movement)
taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress
taskgraph move --from=5,6,7 --from-tag=backlog --to-tag=done --with-dependencies
taskgraph move --from=5 --from-tag=backlog --to-tag=in-progress --ignore-dependencies
```

## Tool Loading Configuration

### Optimizing MCP Tool Loading

Task Master's MCP server supports selective tool loading to reduce context window usage. By default, all 36 tools are loaded (~21,000 tokens) to maintain backward compatibility with existing installations.

You can optimize performance by configuring the `TASK_MASTER_TOOLS` environment variable:

### Available Modes

| Mode | Tools | Context Usage | Use Case |
|------|-------|--------------|----------|
| `all` (default) | 36 | ~21,000 tokens | Complete feature set - all tools available |
| `standard` | 15 | ~10,000 tokens | Common task management operations |
| `core` (or `lean`) | 7 | ~5,000 tokens | Essential daily development workflow |
| `custom` | Variable | Variable | Comma-separated list of specific tools |

### Configuration Methods

#### Method 1: Environment Variable in MCP Configuration

Add `TASK_MASTER_TOOLS` to your MCP configuration file's `env` section:

```jsonc
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "taskgraph-ai"],
      "env": {
        "TASK_MASTER_TOOLS": "standard"  // Options: "all", "standard", "core", "lean", or comma-separated list
      }
    }
  }
}
```

#### Method 2: Claude Code CLI (One-Time Setup)

For Claude Code users, you can set the mode during installation:

```bash
# Core mode example (~70% token reduction)
claude mcp add taskgraph-ai --scope user \
  --env TASK_MASTER_TOOLS="core" \
  -- npx -y taskgraph-ai@latest

# Custom tools example
claude mcp add taskgraph-ai --scope user \
  --env TASK_MASTER_TOOLS="get_tasks,next_task,set_task_status" \
  -- npx -y taskgraph-ai@latest
```

### Tool Sets Details

**Core Tools (7):** `get_tasks`, `next_task`, `get_task`, `set_task_status`, `update_subtask`, `parse_prd`, `expand_task`

**Standard Tools (15):** All core tools plus `initialize_project`, `analyze_project_complexity`, `expand_all`, `add_subtask`, `remove_task`, `generate`, `add_task`, `complexity_report`

**All Tools (36):** Complete set including project setup, task management, analysis, dependencies, tags, research, and more

### Recommendations

- **New users**: Start with `"standard"` mode for a good balance
- **Large projects**: Use `"core"` mode to minimize token usage
- **Complex workflows**: Use `"all"` mode or custom selection
- **Backward compatibility**: If not specified, defaults to `"all"` mode

## Claude Code Support

Task Master runs on Claude Code, which needs no API key:

- **Models**: `opus`, `sonnet` and `haiku`
- **Requirements**: Claude Code CLI installed and signed in
- **Research**: the research role gets web search and fetch access only, with no file or shell access

[Learn more about Claude Code setup](docs/examples/claude-code-usage.md)

## Troubleshooting

### If `taskgraph init` doesn't respond

Try running it with Node directly:

```bash
node node_modules/taskgraph-ai/scripts/init.js
```

Or clone the repository and run:

```bash
git clone https://github.com/stephennmiller/taskgraph-ai.git
cd taskgraph-ai
node scripts/init.js
```

## Contributors

<a href="https://github.com/stephennmiller/taskgraph-ai/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=stephennmiller/taskgraph-ai" alt="Task Master project contributors" />
</a>

## Licensing

Task Master is licensed under the MIT License with Commons Clause. This means you can:

**Allowed**:

- Use Task Master for any purpose (personal, commercial, academic)
- Modify the code
- Distribute copies
- Create and sell products built using Task Master

**Not Allowed**:

- Sell Task Master itself
- Offer Task Master as a hosted service
- Create competing products based on Task Master

See the [LICENSE](LICENSE) file for the complete license text and [licensing details](docs/licensing.md) for more information.
