# TaskGraph - Agent Integration Guide

## Essential Commands

### Core Workflow Commands

```bash
# Project Setup
taskgraph init                                    # Initialize TaskGraph in current project
taskgraph parse-prd .taskgraph/docs/prd.md       # Generate tasks from PRD document
taskgraph models --setup                        # Configure AI models interactively

# Daily Development Workflow
taskgraph list                                   # Show all tasks with status
taskgraph next                                   # Get next available task to work on
taskgraph show <id>                             # View detailed task information (e.g., taskgraph show 1.2)
taskgraph set-status --id=<id> --status=done    # Mark task complete

# Task Management
taskgraph add-task --prompt="description" --research        # Add new task with AI assistance
taskgraph expand --id=<id> --research --force              # Break task into subtasks
taskgraph update-task --id=<id> --prompt="changes"         # Update specific task
taskgraph update --from=<id> --prompt="changes"            # Update multiple tasks from ID onwards
taskgraph update-subtask --id=<id> --prompt="notes"        # Add implementation notes to subtask

# Analysis & Planning
taskgraph analyze-complexity --research          # Analyze task complexity
taskgraph complexity-report                      # View complexity analysis
taskgraph expand --all --research               # Expand all eligible tasks

# Dependencies & Organization
taskgraph add-dependency --id=<id> --depends-on=<id>       # Add task dependency
taskgraph move --from=<id> --to=<id>                       # Reorganize task hierarchy
taskgraph validate-dependencies                            # Check for dependency issues
```

## Key Files & Project Structure

### Core Files

- `.taskgraph/tasks/tasks.json` - Main task data file (auto-managed)
- `.taskgraph/config.json` - AI model configuration (use `taskgraph models` to modify)
- `.taskgraph/docs/prd.md` - Product Requirements Document for parsing (`.md` extension recommended for better editor support)
- `.taskgraph/tasks/*.txt` - Individual task files (auto-generated from tasks.json)
- `.env` - API keys for CLI usage

**PRD File Format:** While both `.txt` and `.md` extensions work, **`.md` is recommended** because:
- Markdown syntax highlighting in editors improves readability
- Proper rendering when previewing in VS Code, GitHub, or other tools
- Better collaboration through formatted documentation

### Claude Code Integration Files

- `CLAUDE.md` - Auto-loaded context for Claude Code (this file)
- `.claude/settings.json` - Claude Code tool allowlist and preferences
- `.claude/commands/` - Custom slash commands for repeated workflows
- `.mcp.json` - MCP server configuration (project-specific)

### Directory Structure

```
project/
├── .taskgraph/
│   ├── tasks/              # Task files directory
│   │   ├── tasks.json      # Main task database
│   │   ├── task-1.md      # Individual task files
│   │   └── task-2.md
│   ├── docs/              # Documentation directory
│   │   ├── prd.md         # Product requirements (.md recommended)
│   ├── reports/           # Analysis reports directory
│   │   └── task-complexity-report.json
│   ├── templates/         # Template files
│   │   └── example_prd.md  # Example PRD template (.md recommended)
│   └── config.json        # AI models & settings
├── .claude/
│   ├── settings.json      # Claude Code configuration
│   └── commands/         # Custom slash commands
├── .env                  # API keys
├── .mcp.json            # MCP configuration
└── CLAUDE.md            # This file - auto-loaded by Claude Code
```

## Slash Commands & CLI (Preferred)

Use slash commands or the `taskgraph` CLI first. They need no MCP server and load no extra tool definitions into context. Only fall back to the MCP tools below when a command you need has no slash command or CLI equivalent.

After `taskgraph init --rules claude`, the slash commands live under `/tm:` (type `/tm` to list them):

| Task | Slash command | CLI |
|------|---------------|-----|
| Find next task | `/tm:next-task` | `taskgraph next` |
| View a task | `/tm:show-task <id>` | `taskgraph show <id>` |
| List tasks | `/tm:list-tasks` | `taskgraph list` |
| Parse a PRD | `/tm:parse-prd` | `taskgraph parse-prd <file>` |
| Add a task | `/tm:add-task` | `taskgraph add-task --prompt="..."` |
| Break into subtasks | `/tm:expand-task <id>` | `taskgraph expand --id=<id>` |
| Change status | `/tm:to-in-progress <id>`, `/tm:to-done <id>`, `/tm:to-review <id>` | `taskgraph set-status --id=<id> --status=<status>` |
| Update a task | `/tm:update-task <id>` | `taskgraph update-task --id=<id> --prompt="..."` |
| Check complexity | `/tm:analyze-complexity` | `taskgraph analyze-complexity` |

## MCP Integration (Optional)

TaskGraph also provides an MCP server that Claude Code can connect to. It is optional; the slash commands and CLI above cover the same workflow. To use it, configure `.mcp.json`:

```json
{
  "mcpServers": {
    "taskgraph-ai": {
      "command": "npx",
      "args": ["-y", "taskgraph-ai"],
      "env": {
        "TASKGRAPH_TOOLS": "core",
        "ANTHROPIC_API_KEY": "your_key_here",
        "PERPLEXITY_API_KEY": "your_key_here",
        "OPENAI_API_KEY": "OPENAI_API_KEY_HERE",
        "GOOGLE_API_KEY": "GOOGLE_API_KEY_HERE",
        "XAI_API_KEY": "XAI_API_KEY_HERE",
        "OPENROUTER_API_KEY": "OPENROUTER_API_KEY_HERE",
        "MISTRAL_API_KEY": "MISTRAL_API_KEY_HERE",
        "AZURE_OPENAI_API_KEY": "AZURE_OPENAI_API_KEY_HERE",
        "OLLAMA_API_KEY": "OLLAMA_API_KEY_HERE"
      }
    }
  }
}
```

### MCP Tool Tiers

TaskGraph uses tiered tool loading to optimize context window usage:

| Tier | Tools | Use Case |
|------|-------|----------|
| `core` | 7 | Minimal daily workflow tools (default) |
| `standard` | 14 | Common task management |
| `all` | 42+ | Full suite with research, autopilot, dependencies |

**Core tools (7):** `get_tasks`, `next_task`, `get_task`, `set_task_status`, `update_subtask`, `parse_prd`, `expand_task`

**Standard adds (7 more):** `initialize_project`, `analyze_project_complexity`, `expand_all`, `add_subtask`, `remove_task`, `add_task`, `complexity_report`

**All tier adds:** Dependency management, tag management, research, autopilot TDD workflow, scope up/down, models

**To upgrade tiers:** Change `TASKGRAPH_TOOLS` in `.mcp.json` from `"core"` to `"standard"` or `"all"` and restart the MCP connection.

### Essential MCP Tools

```javascript
help; // = shows available taskgraph commands
// Project setup
initialize_project; // = taskgraph init
parse_prd; // = taskgraph parse-prd

// Daily workflow
get_tasks; // = taskgraph list
next_task; // = taskgraph next
get_task; // = taskgraph show <id>
set_task_status; // = taskgraph set-status

// Task management
add_task; // = taskgraph add-task
expand_task; // = taskgraph expand
update_task; // = taskgraph update-task
update_subtask; // = taskgraph update-subtask
update; // = taskgraph update

// Analysis
analyze_project_complexity; // = taskgraph analyze-complexity
complexity_report; // = taskgraph complexity-report
```

## Claude Code Workflow Integration

### Standard Development Workflow

#### 1. Project Initialization

```bash
# Initialize TaskGraph
taskgraph init

# Create or obtain PRD, then parse it (use .md extension for better editor support)
taskgraph parse-prd .taskgraph/docs/prd.md

# Analyze complexity and expand tasks
taskgraph analyze-complexity --research
taskgraph expand --all --research
```

If tasks already exist, another PRD can be parsed (with new information only!) using parse-prd with --append flag. This will add the generated tasks to the existing list of tasks..

#### 2. Daily Development Loop

```bash
# Start each session
taskgraph next                           # Find next available task
taskgraph show <id>                     # Review task details

# During implementation, check in code context into the tasks and subtasks
taskgraph update-subtask --id=<id> --prompt="implementation notes..."

# Complete tasks
taskgraph set-status --id=<id> --status=done
```

#### 3. Multi-Claude Workflows

For complex projects, use multiple Claude Code sessions:

```bash
# Terminal 1: Main implementation
cd project && claude

# Terminal 2: Testing and validation
cd project-test-worktree && claude

# Terminal 3: Documentation updates
cd project-docs-worktree && claude
```

### Custom Slash Commands

Create `.claude/commands/taskgraph-next.md`:

```markdown
Find the next available TaskGraph task and show its details.

Steps:

1. Run `taskgraph next` to get the next task
2. If a task is available, run `taskgraph show <id>` for full details
3. Provide a summary of what needs to be implemented
4. Suggest the first implementation step
```

Create `.claude/commands/taskgraph-complete.md`:

```markdown
Complete a TaskGraph task: $ARGUMENTS

Steps:

1. Review the current task with `taskgraph show $ARGUMENTS`
2. Verify all implementation is complete
3. Run any tests related to this task
4. Mark as complete: `taskgraph set-status --id=$ARGUMENTS --status=done`
5. Show the next available task with `taskgraph next`
```

## Tool Allowlist Recommendations

Add to `.claude/settings.json`:

```json
{
  "allowedTools": [
    "Edit",
    "Bash(taskgraph *)",
    "Bash(git commit:*)",
    "Bash(git add:*)",
    "Bash(npm run *)",
    "mcp__taskgraph_ai__*"
  ]
}
```

## Configuration & Setup

### API Keys Required

At least **one** of these API keys must be configured:

- `ANTHROPIC_API_KEY` (Claude models) - **Recommended**
- `PERPLEXITY_API_KEY` (Research features) - **Highly recommended**
- `OPENAI_API_KEY` (GPT models)
- `GOOGLE_API_KEY` (Gemini models)
- `MISTRAL_API_KEY` (Mistral models)
- `OPENROUTER_API_KEY` (Multiple models)
- `XAI_API_KEY` (Grok models)

An API key is required for any provider used across any of the 3 roles defined in the `models` command.

### Model Configuration

```bash
# Interactive setup (recommended)
taskgraph models --setup

# Set specific models
taskgraph models --set-main claude-sonnet-5-5
taskgraph models --set-research perplexity-llama-3.1-sonar-large-128k-online
taskgraph models --set-fallback gpt-4o-mini
```

## Task Structure & IDs

### Task ID Format

- Main tasks: `1`, `2`, `3`, etc.
- Subtasks: `1.1`, `1.2`, `2.1`, etc.
- Sub-subtasks: `1.1.1`, `1.1.2`, etc.

### Task Status Values

- `pending` - Ready to work on
- `in-progress` - Currently being worked on
- `done` - Completed and verified
- `deferred` - Postponed
- `cancelled` - No longer needed
- `blocked` - Waiting on external factors

### Task Fields

```json
{
  "id": "1.2",
  "title": "Implement user authentication",
  "description": "Set up JWT-based auth system",
  "status": "pending",
  "priority": "high",
  "dependencies": ["1.1"],
  "details": "Use bcrypt for hashing, JWT for tokens...",
  "testStrategy": "Unit tests for auth functions, integration tests for login flow",
  "subtasks": []
}
```

## Claude Code Best Practices with TaskGraph

### Context Management

- Use `/clear` between different tasks to maintain focus
- This CLAUDE.md file is automatically loaded for context
- Use `taskgraph show <id>` to pull specific task context when needed

### Iterative Implementation

1. `taskgraph show <subtask-id>` - Understand requirements
2. Explore codebase and plan implementation
3. `taskgraph update-subtask --id=<id> --prompt="detailed plan"` - Log plan
4. `taskgraph set-status --id=<id> --status=in-progress` - Start work
5. Implement code following logged plan
6. `taskgraph update-subtask --id=<id> --prompt="what worked/didn't work"` - Log progress
7. `taskgraph set-status --id=<id> --status=done` - Complete task

### Complex Workflows with Checklists

For large migrations or multi-step processes:

1. Create a markdown PRD file describing the new changes: `touch task-migration-checklist.md` (prds can be .txt or .md)
2. Use TaskGraph to parse the new prd with `taskgraph parse-prd --append` (also available in MCP)
3. Use TaskGraph to expand the newly generated tasks into subtasks. Consdier using `analyze-complexity` with the correct --to and --from IDs (the new ids) to identify the ideal subtask amounts for each task. Then expand them.
4. Work through items systematically, checking them off as completed
5. Use `taskgraph update-subtask` to log progress on each task/subtask and/or updating/researching them before/during implementation if getting stuck

### Git Integration

TaskGraph works well with `gh` CLI:

```bash
# Create PR for completed task
gh pr create --title "Complete task 1.2: User authentication" --body "Implements JWT auth system as specified in task 1.2"

# Reference task in commits
git commit -m "feat: implement JWT auth (task 1.2)"
```

### Parallel Development with Git Worktrees

```bash
# Create worktrees for parallel task development
git worktree add ../project-auth feature/auth-system
git worktree add ../project-api feature/api-refactor

# Run Claude Code in each worktree
cd ../project-auth && claude    # Terminal 1: Auth work
cd ../project-api && claude     # Terminal 2: API work
```

## Troubleshooting

### AI Commands Failing

```bash
# Check API keys are configured
cat .env                           # For CLI usage

# Verify model configuration
taskgraph models

# Test with different model
taskgraph models --set-fallback gpt-4o-mini
```

### MCP Connection Issues (only if you use MCP)

- Check `.mcp.json` configuration
- Verify Node.js installation
- Use `--mcp-debug` flag when starting Claude Code
- Slash commands and the CLI work without MCP; use them if the server will not connect

### Task File Sync Issues

```bash
# Fix dependency issues
taskgraph fix-dependencies
```

DO NOT RE-INITIALIZE. That will not do anything beyond re-adding the same TaskGraph core files.

## Important Notes

### AI-Powered Operations

These commands make AI calls and may take up to a minute:

- `parse_prd` / `taskgraph parse-prd`
- `analyze_project_complexity` / `taskgraph analyze-complexity`
- `expand_task` / `taskgraph expand`
- `expand_all` / `taskgraph expand --all`
- `add_task` / `taskgraph add-task`
- `update` / `taskgraph update`
- `update_task` / `taskgraph update-task`
- `update_subtask` / `taskgraph update-subtask`

### File Management

- Never manually edit `tasks.json` - use commands instead
- Never manually edit `.taskgraph/config.json` - use `taskgraph models`

### Claude Code Session Management

- Use `/clear` frequently to maintain focused context
- Create custom slash commands for repeated TaskGraph workflows
- Configure tool allowlist to streamline permissions
- Use headless mode for automation: `claude -p "taskgraph next"`

### Multi-Task Updates

- Use `update --from=<id>` to update multiple future tasks
- Use `update-task --id=<id>` for single task updates
- Use `update-subtask --id=<id>` for implementation logging

### Research Mode

- Add `--research` flag for research-based AI enhancement
- Requires a research model API key like Perplexity (`PERPLEXITY_API_KEY`) in environment
- Provides more informed task creation and updates
- Recommended for complex technical tasks

---

_This guide ensures Claude Code has immediate access to TaskGraph's essential functionality for agentic development workflows._
