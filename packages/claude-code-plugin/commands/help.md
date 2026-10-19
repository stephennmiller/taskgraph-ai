---
description: "Show help for TaskGraph commands."
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
- `/taskgraph:install-taskgraph` - Comprehensive installation guide
- `/taskgraph:quick-install-taskgraph` - One-line global install

#### 📋 Project Setup
- `/taskgraph:init-project` - Initialize new project
- `/taskgraph:init-project-quick` - Quick setup with auto-confirm
- `/taskgraph:view-models` - View AI configuration
- `/taskgraph:setup-models` - Configure AI providers

#### 🎯 Task Generation
- `/taskgraph:parse-prd` - Generate tasks from PRD
- `/taskgraph:parse-prd-with-research` - Enhanced parsing
- `/taskgraph:generate-tasks` - Create task files

#### 📝 Task Management
- `/taskgraph:list-tasks` - List all tasks
- `/taskgraph:list-tasks-by-status` - List tasks filtered by status
- `/taskgraph:list-tasks-with-subtasks` - List tasks with subtasks
- `/taskgraph:graph` - Show tasks as a dependency tree
- `/taskgraph:show-task` - Display task details
- `/taskgraph:add-task` - Create new task
- `/taskgraph:update-task` - Update single task
- `/taskgraph:update-tasks-from-id` - Update multiple tasks
- `/taskgraph:next-task` - Get next task recommendation

#### 🔄 Status Management
- `/taskgraph:to-pending` - Set task to pending
- `/taskgraph:to-in-progress` - Set task to in-progress
- `/taskgraph:to-done` - Set task to done
- `/taskgraph:to-review` - Set task to review
- `/taskgraph:to-deferred` - Set task to deferred
- `/taskgraph:to-cancelled` - Set task to cancelled

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
- `/taskgraph:remove-subtask` - Remove subtask
- `/taskgraph:remove-subtasks` - Clear specific task subtasks
- `/taskgraph:remove-all-subtasks` - Clear all subtasks

#### 🗑️ Task Removal
- `/taskgraph:remove-task` - Remove task permanently

#### 🤖 Workflows
- `/taskgraph:smart-workflow` - Intelligent workflows
- `/taskgraph:command-pipeline` - Command chaining
- `/taskgraph:auto-implement-tasks` - Auto-implementation

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

1. Install: `/taskgraph:quick-install-taskgraph`
2. Initialize: `/taskgraph:init-project-quick`
3. Learn: `/taskgraph:learn`
4. Work: `/taskgraph:smart-workflow`

For detailed command info, run the specific command with `--help` or check command documentation.