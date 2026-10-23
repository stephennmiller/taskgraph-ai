---
description: "TaskGraph Command Reference"
argument-hint: "[arguments]"
---

# TaskGraph Command Reference

Every slash command the TaskGraph plugin provides, grouped by purpose. Invoke them as `/taskgraph:<name>`.

## Project Setup & Configuration

- `/taskgraph:init-project [--quick]` - Initialize new project (handles PRD files intelligently); `--quick` skips prompts (-y)
- `/taskgraph:install-taskgraph [--quick]` - Installation guide; `--quick` for a one-line global install
- `/taskgraph:view-models` - View current AI model configuration
- `/taskgraph:setup-models` - Interactive model configuration

## Task Generation

- `/taskgraph:parse-prd` - Generate tasks from a PRD document
- `/taskgraph:parse-prd-with-research` - Enhanced parsing with research mode

## Task Management

- `/taskgraph:list-tasks [status] [--subtasks]` - Smart listing with natural language filters, by status, with subtasks
- `/taskgraph:graph` - Dependency tree with the next task marked
- `/taskgraph:why <id>` - Explain why a task is blocked, down to the root causes
- `/taskgraph:set-status <id> <status>` - Set any status (pending, review, deferred, cancelled, blocked, ...)
- `/taskgraph:to-in-progress` - Start working on a task
- `/taskgraph:to-done` - Check acceptance criteria, save a close summary, mark complete
- `/taskgraph:sync-readme` - Export tasks to README.md with formatting
- `/taskgraph:add-task` - Add a new task with AI assistance
- `/taskgraph:update-task` - Update a single task
- `/taskgraph:update-tasks-from-id` - Update multiple tasks from a starting point
- `/taskgraph:remove-task` - Remove a task with confirmation

## Subtask Management

- `/taskgraph:add-subtask` - Add a new subtask to a parent
- `/taskgraph:convert-task-to-subtask` - Convert an existing task to a subtask
- `/taskgraph:remove-subtask <id> [--convert]` - Remove one subtask (optionally converting it to a task)
- `/taskgraph:clear-subtasks [<id>|--all]` - Clear subtasks from one task, or from every task with `--all`

## Task Analysis & Breakdown

- `/taskgraph:analyze-complexity` - Analyze and generate expansion recommendations
- `/taskgraph:complexity-report` - Display the complexity analysis report
- `/taskgraph:expand-task` - Break down a specific task
- `/taskgraph:expand-all-tasks` - Expand all eligible tasks

## Task Navigation

- `/taskgraph:next-task` - Intelligent next task recommendation
- `/taskgraph:show-task` - Display detailed task information
- `/taskgraph:project-status` - Comprehensive project dashboard

## Dependency Management

- `/taskgraph:add-dependency` - Add a task dependency
- `/taskgraph:remove-dependency` - Remove a task dependency
- `/taskgraph:validate-dependencies` - Check for dependency issues
- `/taskgraph:fix-dependencies` - Automatically fix dependency problems

## Workflows & Automation

- `/taskgraph:smart-workflow` - Context-aware intelligent workflow execution
- `/taskgraph:command-pipeline` - Chain multiple commands together
- `/taskgraph:auto-implement-tasks` - Advanced auto-implementation with code generation
- `/taskgraph:analyze-project` - Deep project analysis and insights
- `/taskgraph:learn` - Interactive guide to TaskGraph
- `/taskgraph:help` - Command overview

## Usage Patterns

### Natural Language
Most commands accept natural language arguments:
```
/taskgraph:add-task create user authentication system
/taskgraph:update-task 12 mark this as high priority
/taskgraph:list-tasks show blocked tasks
```

### ID-Based Commands
Commands requiring IDs intelligently parse from $ARGUMENTS:
```
/taskgraph:show-task 45
/taskgraph:expand-task 23
/taskgraph:to-done 67
```

### Smart Defaults
Commands provide intelligent defaults and suggestions based on context.
