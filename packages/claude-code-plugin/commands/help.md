---
description: "TaskGraph: list the TaskGraph commands and what each does."
argument-hint: "[arguments]"
---

Show help for TaskGraph commands.

Arguments: $ARGUMENTS

Display help for TaskGraph commands. If arguments provided, show specific command help.

## TaskGraph Command Help

### Quick Navigation

Type `/taskgraph:` and use tab completion to explore all commands.

### Command Categories

#### 🚀 Setup & Installation
- `/taskgraph:install-taskgraph [--quick]` - Installation guide, or a one-line global install with `--quick`

#### 📋 Project Setup
- `/taskgraph:init-project [--quick]` - Initialize new project, or skip prompts with `--quick`
- `/taskgraph:view-models` - View AI configuration
- `/taskgraph:setup-models` - Configure AI providers

#### 🎯 Task Generation
- `/taskgraph:parse-prd` - Generate tasks from PRD
- `/taskgraph:parse-prd-with-research` - Enhanced parsing

#### 📝 Task Management
- `/taskgraph:list-tasks [status] [--subtasks]` - List tasks, optionally by status or with subtasks
- `/taskgraph:graph` - Show tasks as a dependency tree
- `/taskgraph:why <id>` - Explain why a task is blocked
- `/taskgraph:show-task` - Display task details
- `/taskgraph:add-task` - Create new task
- `/taskgraph:update-task` - Update a single task
- `/taskgraph:update-tasks-from-id` - Update multiple tasks
- `/taskgraph:next-task` - Get next task recommendation

#### 🔄 Status Management
- `/taskgraph:set-status <id> <status>` - Set any status (pending, review, deferred, cancelled, blocked, ...)
- `/taskgraph:to-in-progress` - Shortcut: set task to in-progress
- `/taskgraph:to-done` - Check acceptance criteria against your changes, save a close summary, set done

#### 🔍 Analysis & Breakdown
- `/taskgraph:analyze-complexity` - Analyze task complexity
- `/taskgraph:complexity-report` - View complexity report
- `/taskgraph:expand-task` - Break down complex task
- `/taskgraph:expand-all-tasks` - Expand all eligible tasks

#### 🔗 Dependencies
- `/taskgraph:add-dependency` - Add task dependency
- `/taskgraph:remove-dependency` - Remove dependency
- `/taskgraph:validate-dependencies` - Check for issues
- `/taskgraph:fix-dependencies` - Auto-fix dependency issues

#### 📦 Subtasks
- `/taskgraph:add-subtask` - Add subtask to task
- `/taskgraph:convert-task-to-subtask` - Convert task to subtask
- `/taskgraph:remove-subtask <id> [--convert]` - Remove one subtask
- `/taskgraph:clear-subtasks [<id>|--all]` - Clear subtasks from one task, or from every task

#### 🗑️ Task Removal
- `/taskgraph:remove-task` - Remove task permanently

#### 🤖 Run an agent over the plan
- `taskgraph loop` (in a terminal) - Claude Code works the tasks one per iteration; `--prompt tdd` for test-first, `--parallel <n>` for independent tasks side by side

#### 📊 Utilities
- `/taskgraph:analyze-project` - Project analysis
- `/taskgraph:project-status` - Project dashboard
- `/taskgraph:sync-readme` - Sync README with tasks
- `/taskgraph:learn` - Interactive learning
- `/taskgraph:tm-main` - Main TaskGraph interface

### Quick Start Examples

```
/taskgraph:list-tasks
/taskgraph:show-task 1.2
/taskgraph:add-task
/taskgraph:next-task
```

### Getting Started

1. Install: `/taskgraph:install-taskgraph --quick`
2. Initialize: `/taskgraph:init-project --quick`
3. Learn: `/taskgraph:learn`
4. Work: `/taskgraph:next-task`

For detailed command info, run the specific command with `--help` or check command documentation.